"""Small verified operations layered on the pre-imported Browser Use CLI helpers."""

import hashlib
import json
import os
import signal
import time
import uuid
from functools import wraps
from pathlib import Path

from browser_harness import helpers as _leon_helpers


_LEON_WAIT_SECONDS = 10
_LEON_MAX_WAIT_SECONDS = 30
_LEON_DOWNLOAD_SECONDS = 20
_LEON_POLL_SECONDS = 0.1
_LEON_DEFAULT_ITEMS = 40
_LEON_MAX_ITEMS = 80
_LEON_TEXT_LIMIT = 3_000
_LEON_ITEM_TEXT_LIMIT = 300
_LEON_LABEL_LIMIT = 200
_LEON_HREF_LIMIT = 1_000
_LEON_ACTIONS = []


class BrowserWorkflowError(RuntimeError):
    """A recoverable browser state, distinct from a failed Python program."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# Keep upstream helpers, but never let their implicit-session recovery choose
# another page. This adapter lives only in this tool's CLI subprocess.
_leon_native_send = _leon_helpers._send
_LEON_TARGET_ID = None
_LEON_SESSION_ID = None


def switch_tab(target, activate=False):
    """Bind page commands to this exact target without querying the old renderer."""
    global _LEON_TARGET_ID, _LEON_SESSION_ID
    target_id = _leon_helpers._target_id(target)
    # Clear the previous binding before attach: a failed switch must not leave
    # subsequent commands able to edit the previous page accidentally.
    _LEON_TARGET_ID, _LEON_SESSION_ID = target_id if isinstance(target_id, str) else '', None
    if not _LEON_TARGET_ID:
        raise BrowserWorkflowError('invalid_tab', 'Use an observed, nonempty tab ID. No page command sent.')
    response = _leon_native_send({'method': 'Target.attachToTarget',
                                 'params': {'targetId': target_id, 'flatten': True}})
    session_id = response['result']['sessionId']
    _leon_native_send({'meta': 'set_session', 'session_id': session_id, 'target_id': target_id})
    _LEON_SESSION_ID = session_id
    if activate:
        activate_tab(target_id)
    return session_id


def _leon_send(request, **kwargs):
    """Use explicit sessions so daemon recovery cannot replay input on another tab."""
    if _LEON_TARGET_ID == '':
        raise BrowserWorkflowError('invalid_tab', 'Select an observed tab before continuing.')
    if request.get('meta') == 'current_tab' and _LEON_TARGET_ID is not None:
        return _leon_native_send({'method': 'Target.getTargetInfo',
                                 'params': {'targetId': _LEON_TARGET_ID}}, **kwargs)['result']['targetInfo']
    if request.get('meta') == 'session' and _LEON_SESSION_ID is not None:
        return {'session_id': _LEON_SESSION_ID}
    method = request.get('method')
    if method and not method.startswith('Target.') and not request.get('session_id'):
        if _LEON_SESSION_ID is None:
            target = _LEON_TARGET_ID or _leon_native_send({'meta': 'current_tab'})['targetId']
            switch_tab(target)
        request = {**request, 'session_id': _LEON_SESSION_ID}
    return _leon_native_send(request, **kwargs)


def new_tab(url='about:blank'):
    """Create a distinct tab and navigate once, preserving its identity on failure."""
    target_id = cdp('Target.createTarget', url='about:blank', background=True)['targetId']
    switch_tab(target_id)
    if url != 'about:blank':
        goto_url(url)
    return target_id


_leon_helpers._send = _leon_send
_leon_helpers.switch_tab = switch_tab
_leon_helpers.new_tab = new_tab


def _leon_save_actions():
    """Persist outcomes even if user code catches an error or is interrupted."""
    journal = os.environ.get('LEON_BROWSER_ACTIONS')
    if journal:
        destination = Path(journal)
        temporary = destination.with_suffix('.tmp')
        temporary.write_text(json.dumps(_LEON_ACTIONS), encoding='utf-8')
        temporary.replace(destination)


def _leon_operation(name):
    """Publish action evidence for Leon's existing convergence checks."""
    def decorate(function):
        @wraps(function)
        def execute(target, *args, **kwargs):
            record = {'action': name, 'target': target, 'tab_id': current_tab()['targetId'],
                      'effect': 'not_sent', 'success': False}
            if name == 'fill':
                value = args[0] if args else kwargs.get('value', '')
                record['value_hash'] = hashlib.sha256(str(value).encode()).hexdigest()
            _LEON_ACTIONS.append(record)
            _leon_save_actions()
            try:
                result = function(target, *args, **kwargs)
                record.update({'success': True, 'effect': 'observed'})
                return result
            except BaseException as error:
                record['error_code'] = getattr(error, 'code', 'outcome_timeout' if isinstance(error, TimeoutError) else 'operation_failed')
                record['message'] = str(error)
                raise
            finally:
                try:
                    observation = _leon_snapshot('button,a,input,[role="dialog"]', 0, 20)
                    record['state_id'] = observation['state_id']
                    if not record['success']:
                        record['observation'] = observation
                except Exception:
                    # Preserve the action outcome if navigation interrupted inspection.
                    pass
                _leon_save_actions()
        return execute
    return decorate


def _leon_interrupted(signum, frame):
    """Let active download cleanup run when the CLI's execution budget expires."""
    raise BrowserWorkflowError('canceled', 'Browser script interrupted. Inspect partial effects before retrying.')


signal.signal(signal.SIGTERM, _leon_interrupted)
signal.signal(signal.SIGINT, _leon_interrupted)


_LEON_DOM = r"""
const visible = e => e.checkVisibility({checkVisibilityCSS:true, checkOpacity:true}) &&
  !e.closest('[inert],[aria-hidden="true"]');
const text = (root, limit) => {
  if (!root) return '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let result = '', node;
  while (result.length < limit && (node = walker.nextNode())) {
    if (node.parentElement && visible(node.parentElement)) result += ' ' + node.textContent.trim();
  }
  return result.trim().slice(0, limit);
};
const context = (e, limit) => {
  const row = e.closest('tr,[role="row"],li,[role="listitem"]');
  return row ? text(row, limit) : '';
};
const selectorFor = e => {
  const parts = [];
  while (e && e !== document.documentElement) {
    if (e.id && document.querySelectorAll('#' + CSS.escape(e.id)).length === 1) {
      parts.unshift('#' + CSS.escape(e.id));
      return parts.join(' > ');
    }
    parts.unshift(e.localName + ':nth-child(' + (Array.from(e.parentElement.children).indexOf(e) + 1) + ')');
    const candidate = parts.join(' > ');
    if (Array.from(document.querySelectorAll(candidate)).filter(visible).length === 1) return candidate;
    e = e.parentElement;
  }
  return ['html', ...parts].join(' > ');
};
"""


def _leon_ready():
    """Give interactive pages a live renderer before checking their DOM state."""
    # Background tabs may pause animation and leave real controls at opacity zero.
    # Upstream attachment alone does not activate the tab.
    activate_tab(current_tab())
    leon_wait("document.body !== null && document.readyState !== 'loading'")


def _leon_snapshot(selector, offset, limit):
    """Extract only bounded, rendered evidence; no action or navigation retry."""
    if offset < 0 or not 1 <= limit <= _LEON_MAX_ITEMS:
        raise ValueError(f"Use offset >= 0 and limit between 1 and {_LEON_MAX_ITEMS}.")
    result = js("(() => {" + _LEON_DOM + f"""
      const nodes = Array.from(document.querySelectorAll({json.dumps(selector)})).filter(visible);
      const items = nodes.slice({offset}, {offset + limit}).map(e => ({{
        selector: selectorFor(e), tag: e.localName, role: e.getAttribute('role'),
        text: text(e, {_LEON_ITEM_TEXT_LIMIT}), label: (e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').slice(0, {_LEON_LABEL_LIMIT}),
        context: context(e, {_LEON_ITEM_TEXT_LIMIT}),
        href: e.getAttribute('href')?.length <= {_LEON_HREF_LIMIT} ? e.getAttribute('href') : null,
        href_omitted: e.getAttribute('href')?.length > {_LEON_HREF_LIMIT},
        disabled: e.matches(':disabled,[aria-disabled="true"]')
      }}));
      return {{url: location.href, title: document.title, text: text(document.body, {_LEON_TEXT_LIMIT}),
        items, total: nodes.length, next_offset: nodes.length > {offset + limit} ? {offset + limit} : null}};
    }})()""")
    result['tab_id'] = current_tab()['targetId']
    # Inspection scope must not affect the state used to recognize repeated input.
    evidence = js("(() => {" + _LEON_DOM + f"return [location.href, text(document.body, {_LEON_TEXT_LIMIT})];" + "})()")
    result['state_id'] = hashlib.sha256(json.dumps(evidence).encode()).hexdigest()[:16]
    return result


def leon_observe(selector='a,button,input,textarea,select,[role="button"],[role="dialog"],dialog,tr,[role="row"]', offset=0, limit=_LEON_DEFAULT_ITEMS):
    """Return a ready, compact page inventory with reusable target descriptors."""
    _leon_ready()
    result = _leon_snapshot(selector, offset, limit)
    if not result['text']:
        # Hydration can start after document readiness; do not return an empty
        # application shell as though its inventory were complete.
        try:
            result = leon_wait(lambda: (r if r['text'] else None) if (r := _leon_snapshot(selector, offset, limit)) else None, timeout=2)
        except TimeoutError:
            result['ready'] = False
    return result


def leon_wait(condition, timeout=_LEON_WAIT_SECONDS):
    """Wait for a read-only JS expression or Python predicate; never repeat input."""
    if not 0 < timeout <= _LEON_MAX_WAIT_SECONDS:
        raise ValueError(f"Wait timeout must be between 0 and {_LEON_MAX_WAIT_SECONDS} seconds.")
    deadline = time.monotonic() + timeout
    while True:
        result = condition() if callable(condition) else js(condition)
        if result:
            return result
        if time.monotonic() >= deadline:
            raise TimeoutError("Expected browser outcome was not observed. Inspect before retrying input.")
        time.sleep(min(_LEON_POLL_SECONDS, max(0, deadline - time.monotonic())))


def _leon_target(target, filling=False):
    """Reject ambiguous, hidden, disabled or covered targets before trusted input."""
    _leon_ready()
    descriptor = target if isinstance(target, dict) else {'selector': target}
    selector = descriptor['selector']

    def resolve():
        return js("(() => {" + _LEON_DOM + f"""
      const target = {json.dumps(descriptor)};
      const nodes = Array.from(document.querySelectorAll({json.dumps(selector)})).filter(visible)
        .filter(e => (!target.text || text(e, {_LEON_ITEM_TEXT_LIMIT}) === target.text) &&
          (!target.tag || e.localName === target.tag) && (!target.label ||
          (e.getAttribute('aria-label') || e.getAttribute('placeholder') || '') === target.label) &&
          (!target.context || context(e, {_LEON_ITEM_TEXT_LIMIT}) === target.context));
      if (nodes.length !== 1) return {{code: nodes.length ? 'ambiguous_target' : 'target_not_ready'}};
      const e = nodes[0];
      if (!visible(e) || e.matches(':disabled') || e.closest('[aria-disabled="true"]'))
        return {{code:'target_not_ready'}};
      if ({json.dumps(filling)} && (!e.matches('input,textarea') || e.readOnly))
        return {{code:'not_editable'}};
      e.scrollIntoView({{block:'center', inline:'center', behavior:'instant'}});
      const r = e.getBoundingClientRect();
      const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
      const y = (Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !e.contains(hit)) return {{code:'target_covered'}};
      return {{point:[x, y], selector:selectorFor(e)}};
    }})()""")
    result = resolve()
    if result.get('code') in ('target_not_ready', 'target_covered'):
        # Only readiness is retried, never the input itself.
        try:
            result = leon_wait(lambda: (r if not r.get('code') else None) if (r := resolve()) else None, timeout=2)
        except TimeoutError:
            pass
    if result.get('code'):
        raise BrowserWorkflowError(result['code'], 'No input sent. Inspect the returned controls and use an observed target.')
    return result


def _leon_dispatch(point):
    """Mark delivery uncertain before sending input, including interrupted calls."""
    _LEON_ACTIONS[-1]['effect'] = 'unverifiable'
    _leon_save_actions()
    click_at_xy(*point)


@_leon_operation('click')
def leon_click(target, expect=None, timeout=_LEON_WAIT_SECONDS):
    """Click once with trusted input and require a new, explicit postcondition."""
    if expect is not None and not callable(expect) and not isinstance(expect, str):
        raise ValueError("expect must be a read-only JS expression or Python predicate.")
    if not 0 < timeout <= _LEON_MAX_WAIT_SECONDS:
        raise ValueError(f"Click timeout must be between 0 and {_LEON_MAX_WAIT_SECONDS} seconds.")
    resolved = _leon_target(target)
    before = _leon_snapshot('button,a,[role="dialog"]', 0, 20)
    tabs = {t['targetId'] for t in list_tabs()}
    if expect is not None and (expect() if callable(expect) else js(expect)):
        raise BrowserWorkflowError('already_satisfied', 'Expected outcome already holds. No input sent.')
    _leon_dispatch(resolved['point'])
    if expect is not None:
        return leon_wait(expect, timeout)

    def changed():
        new_tabs = [t for t in list_tabs() if t['targetId'] not in tabs]
        if new_tabs:
            return {'new_tabs': new_tabs}
        after = _leon_snapshot('button,a,[role="dialog"]', 0, 20)
        return {'observation': after} if before['state_id'] != after['state_id'] else None

    return leon_wait(changed, timeout)


@_leon_operation('fill')
def leon_fill(target, value):
    """Focus a visible text field with trusted input and verify the entered value."""
    resolved = _leon_target(target, filling=True)
    selector = resolved['selector']
    _leon_dispatch(resolved['point'])
    if not js(f"document.activeElement === document.querySelector({json.dumps(selector)})"):
        raise RuntimeError("Target did not receive focus. No text sent.")
    fill_input(selector, value)
    leon_wait(f"document.querySelector({json.dumps(selector)})?.value === {json.dumps(value)}")
    # Do not echo potentially sensitive input such as authentication codes.
    return {"value_verified": True}


@_leon_operation('download')
def leon_download(target, expected_text=None, timeout=_LEON_DOWNLOAD_SECONDS):
    """Wait for a native download, then return file and PDF identity evidence."""
    if not 0 < timeout <= _LEON_MAX_WAIT_SECONDS:
        raise ValueError(f"Download timeout must be between 0 and {_LEON_MAX_WAIT_SECONDS} seconds.")
    if expected_text is not None and (not isinstance(expected_text, list) or not expected_text or
                                      any(not isinstance(item, str) or not item.strip() for item in expected_text)):
        raise ValueError("expected_text must be a nonempty list of observed document identity strings.")
    # Resolve prerequisites before changing browser behavior or sending input.
    from pypdfium2 import PdfDocument

    point = _leon_target(target)['point']
    tabs = {t['targetId'] for t in list_tabs()}
    frame_id = cdp('Page.getFrameTree')['frameTree']['frame']['id']
    directory = Path(os.environ['LEON_BROWSER_ARTIFACTS']) / str(uuid.uuid4())
    directory.mkdir(parents=True)
    download = None

    def completed():
        nonlocal download
        for event in drain_events():
            params = event.get('params', {})
            if event.get('method') == 'Browser.downloadWillBegin' and params.get('frameId') == frame_id:
                if download is not None and download['guid'] != params['guid']:
                    raise RuntimeError("Multiple downloads started. Inspect the download directory before continuing.")
                download = params
            if event.get('method') == 'Browser.downloadProgress' and download and params.get('guid') == download['guid']:
                if params.get('state') == 'canceled':
                    raise RuntimeError("Browser canceled the download.")
                if params.get('state') == 'completed':
                    return True
        if any(t['targetId'] not in tabs for t in list_tabs()):
            raise BrowserWorkflowError('download_opened_tab', 'A new tab opened instead of a download. Inspect that tab before downloading.')
        return False

    drain_events()
    _LEON_ACTIONS[-1]['download_override_active'] = True
    _leon_save_actions()
    try:
        cdp('Browser.setDownloadBehavior', behavior='allowAndName', downloadPath=str(directory), eventsEnabled=True)
        _leon_dispatch(point)
        leon_wait(completed, timeout)
        source = directory / download['guid']
        leon_wait(lambda: source.is_file(), timeout=2)
        size = source.stat().st_size
        if not size:
            raise RuntimeError("Downloaded file is empty.")
        filename = Path(download['suggestedFilename'].replace('\\', '/')).name
        target = directory / (filename if filename not in ('', '.', '..') else download['guid'])
        source.rename(target)
        with target.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            stream.seek(0)
            is_pdf = stream.read(5) == b'%PDF-'
        result = {"completed": True, "path": str(target), "size_bytes": size,
                  "sha256": digest, "identity_verified": False}
        if target.suffix.lower() == '.pdf' or is_pdf or expected_text:
            # PDFium resolves embedded font mappings that can turn punctuation
            # into null characters in pure-Python extraction of real invoices.
            with PdfDocument(target) as document:
                pages = len(document)
                if not pages:
                    raise RuntimeError(f"Downloaded PDF has no pages: {target}")
                parts = []
                for page in document:
                    text_page = page.get_textpage()
                    try:
                        parts.append(text_page.get_text_bounded())
                    finally:
                        text_page.close()
                        page.close()
                content = '\n'.join(parts)
            result.update({"pages": pages, "text": content[:_LEON_TEXT_LIMIT],
                           "text_truncated": len(content) > _LEON_TEXT_LIMIT})
            if expected_text:
                normalized = ' '.join(content.split()).casefold()
                if not all(' '.join(item.split()).casefold() in normalized for item in expected_text):
                    _LEON_ACTIONS[-1]['download'] = {k: v for k, v in result.items() if k != 'text'}
                    raise BrowserWorkflowError('document_identity_mismatch', f"Downloaded PDF identity does not match. Inspect {target} before retrying.")
                result['identity_verified'] = True
        _LEON_ACTIONS[-1]['download'] = {k: v for k, v in result.items() if k != 'text'}
        return result
    finally:
        # Restore normal owner downloads even when the action or validation fails.
        cdp('Browser.setDownloadBehavior', behavior='default', eventsEnabled=False)
        _LEON_ACTIONS[-1]['download_override_active'] = False
        _leon_save_actions()


def _leon_execute(code):
    """Keep errors structured and flush the journal after normal or canceled scripts."""
    try:
        exec(compile(code, '<browser-script>', 'exec'), globals())
    except BaseException as error:
        print(json.dumps({'error_code': getattr(error, 'code', 'script_failed'), 'message': str(error)}))
        raise SystemExit(1)
    finally:
        _leon_save_actions()
