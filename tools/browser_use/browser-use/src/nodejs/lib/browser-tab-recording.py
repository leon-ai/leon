"""Capture the selected page through Browser Use's authorized Chromium connection."""

import base64
import math


_RECORDING_FPS = 60
_RECORDING_CHUNK_BYTES = 256 * 1_024
_RECORDING_MAX_BYTES = 256 * 1_024 * 1_024


def _leon_write_tab_video(handle, session_id, destination):
    """Drain the browser-owned stream without buffering the complete video in memory."""
    written = 0
    with destination.open('xb') as output:
        while True:
            response = cdp('IO.read', session_id=session_id, handle=handle, size=_RECORDING_CHUNK_BYTES)
            data = base64.b64decode(response['data'], validate=True)
            written += len(data)
            if written > _RECORDING_MAX_BYTES:
                raise BrowserWorkflowError('recording_too_large', 'The browser recording exceeded its size limit.')
            output.write(data)
            if response['eof']:
                break

    if not written:
        raise BrowserWorkflowError('recording_empty', 'The browser returned an empty recording.')


def _leon_write_tab_cursor(destination, tab_id, started_at, ended_at):
    """Keep observed page coordinates on the video clock for OpenScreen project import."""
    samples = []
    for event in _LEON_PAGE_POINTERS:
        if event['tab_id'] != tab_id or not started_at <= event['at'] <= ended_at:
            continue
        samples.append({'timeMs': event['at'] - started_at, 'cx': event['x'], 'cy': event['y'], 'visible': True,
                        'assetId': None, 'cursorType': None, 'interactionType': 'click' if event['click'] else 'move'})

    if samples:
        samples.insert(0, {**samples[0], 'timeMs': 0, 'interactionType': 'move'})
        samples.append({**samples[-1], 'timeMs': ended_at - started_at, 'interactionType': 'move'})
        destination.write_text(json.dumps({'version': 2, 'provider': 'native', 'assets': [], 'samples': samples}),
                               encoding='utf-8')


def _leon_record_tab(tab_id, code, filename):
    """Run one grounded browser batch while Chromium captures its page viewport."""
    global _LEON_RECORDING_TAB_ID
    script = compile(code, '<browser-recording>', 'exec')
    session_id = switch_tab(tab_id, activate=True)
    width, height, ratio = js('[innerWidth, innerHeight, devicePixelRatio]')
    width, height = (max(2, 2 * math.ceil(value * ratio / 2)) for value in (width, height))
    try:
        started = cdp('Page.startScreenRecording', session_id=session_id, audio=False,
                      maxWidth=width, maxHeight=height, frameRate=_RECORDING_FPS)
    except RuntimeError as error:
        detail = error.args[0] if error.args else None
        if isinstance(detail, dict) and detail.get('code') == -32601:
            raise BrowserWorkflowError('recording_unsupported', 'This browser does not support direct tab recording.') from error
        raise

    started_at = time.time_ns() // 1_000_000
    destination = Path(filename)
    partial = destination.with_suffix('.partial')
    completed = False
    _LEON_RECORDING_TAB_ID = tab_id
    try:
        print('Browser tab recording started.', flush=True)
        exec(script, globals())
        completed = all(action['success'] for action in _LEON_ACTIONS)
    finally:
        ended_at = time.time_ns() // 1_000_000
        _LEON_RECORDING_TAB_ID = None
        handle = started['stream']
        try:
            stopped = cdp('Page.stopScreenRecording', session_id=session_id)
            handle = stopped['stream']
            if completed:
                print('Saving browser tab recording.', flush=True)
                _leon_write_tab_video(handle, session_id, partial)
                _leon_write_tab_cursor(destination.with_name(f'{destination.name}.cursor.json'), tab_id,
                                       started_at, ended_at)
                partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)
            cdp('IO.close', session_id=session_id, handle=handle)
