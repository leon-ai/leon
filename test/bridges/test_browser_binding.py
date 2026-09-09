"""Verify the tool's session adapter without launching an owner's browser."""

from pathlib import Path
import signal
import types
import unittest
from unittest.mock import patch

RUNTIME = Path(__file__).resolve().parents[2] / 'tools/browser_use/src/nodejs/lib/browser-use-runtime.py'


class BrowserBindingTest(unittest.TestCase):
    def test_explicit_sessions_and_failed_switches_never_redirect_input(self):
        requests = []
        sessions = {}
        helpers = types.ModuleType('browser_harness.helpers')

        def send(request, **kwargs):
            requests.append(request)
            method, params = request.get('method'), request.get('params', {})
            if method == 'Target.attachToTarget':
                if params['targetId'] == 'missing':
                    raise RuntimeError('Target not found')
                sid = 'session-' + str(len(sessions))
                sessions[sid] = params['targetId']
                return {'result': {'sessionId': sid}}
            if method == 'Target.createTarget':
                return {'result': {'targetId': 'new'}}
            if method == 'Target.getTargetInfo':
                return {'result': {'targetInfo': {'targetId': params['targetId']}}}
            if request.get('meta') == 'current_tab':
                return {'targetId': 'wrong-default'}
            if method:
                # An implicit session would silently select the wrong page.
                sid = request.get('session_id')
                if sid and sid not in sessions:
                    raise RuntimeError('Session with given id not found')
                return {'result': {'target': sessions.get(sid, 'wrong-default')}}
            return {}

        helpers._send = send
        helpers._target_id = lambda target: target.get('targetId') if isinstance(target, dict) else target
        def cdp(method, **params):
            return helpers._send({'method': method, 'params': params})['result']
        namespace = {'cdp': cdp, 'activate_tab': lambda target: None,
                     'goto_url': lambda url: cdp('Page.navigate', url=url)}
        package = types.ModuleType('browser_harness')
        package.helpers = helpers
        with patch.dict('sys.modules', {'browser_harness': package}), patch.object(signal, 'signal'):
            exec(compile(RUNTIME.read_text(), str(RUNTIME), 'exec'), namespace)
        switch = namespace['switch_tab']
        sid = switch('wanted')
        self.assertEqual(cdp('Input.insertText', text='one')['target'], 'wanted')
        del sessions[sid]
        before = len(requests)
        with self.assertRaises(RuntimeError):
            cdp('Input.insertText', text='two')
        self.assertEqual(len(requests), before + 1)  # No replay after uncertain input.
        with self.assertRaises(RuntimeError):
            switch('missing')
        with self.assertRaises(RuntimeError):
            cdp('Input.insertText', text='three')
        self.assertNotEqual(requests[-1]['method'], 'Input.insertText')
        with self.assertRaises(RuntimeError):
            switch(None)
        with self.assertRaises(RuntimeError):
            cdp('Input.insertText', text='four')
        switch('wanted')
        self.assertEqual(helpers._send({'meta': 'current_tab'})['targetId'], 'wanted')
        self.assertEqual(namespace['new_tab']('https://example.test'), 'new')
        self.assertEqual([r['method'] for r in requests if r.get('method') == 'Page.navigate'], ['Page.navigate'])
        self.assertEqual(cdp('Runtime.evaluate', expression='location.href')['target'], 'new')


if __name__ == '__main__':
    unittest.main()
