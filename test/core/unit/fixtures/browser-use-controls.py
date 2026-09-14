"""Regression checks for the CLI support script, without a browser or model."""

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

helpers = types.ModuleType('browser_harness.helpers')
helpers._send = Mock()
package = types.ModuleType('browser_harness')
package.helpers = helpers
sys.modules['browser_harness'] = package
sys.modules['browser_harness.helpers'] = helpers
runtime = types.ModuleType('leon_browser_runtime')
exec(compile(Path(sys.argv.pop()).read_text(), 'browser-use-runtime.py', 'exec'), runtime.__dict__)


class FormControlsTest(unittest.TestCase):
    def setUp(self):
        runtime._LEON_ACTIONS.clear()
        runtime.current_tab = Mock(return_value={'targetId': 'owned-tab'})
        runtime._leon_snapshot = Mock(return_value={'state_id': 'same-page'})
        runtime._leon_target = Mock(return_value={'point': [10, 20], 'selector': '#choice', 'tag': 'select'})
        runtime._leon_dispatch = Mock()
        runtime.press_key = Mock()
        runtime.leon_wait = Mock(return_value=True)
        runtime.leon_observe = Mock(return_value={'state_id': 'same-page'})
        runtime.list_tabs = Mock(return_value=[{'targetId': 'owned-tab'}])
        self.options = [
            {'index': 0, 'value': 'first', 'disabled': False},
            {'index': 1, 'value': 'blocked', 'disabled': True},
            {'index': 2, 'value': 'last', 'disabled': False}
        ]
        runtime.js = Mock(return_value={'multiple': False, 'options': self.options})

    def test_selection_skips_disabled_options_and_verifies_index_and_value(self):
        result = runtime.leon_select({'selector': '#choice'}, 'last')
        self.assertTrue(result['selection_verified'])
        self.assertEqual([c.args[0] for c in runtime.press_key.call_args_list], ['Home', 'ArrowDown', 'Enter'])
        verification = runtime.leon_wait.call_args.args[0]
        self.assertIn('selectedIndex === 2', verification)
        self.assertIn('e.value === "last"', verification)
        self.assertEqual(runtime._LEON_ACTIONS[-1]['effect'], 'observed')

    def test_invalid_options_do_not_send_input(self):
        for value in ['blocked', 'missing']:
            with self.subTest(value=value), self.assertRaises(runtime.BrowserWorkflowError):
                runtime.leon_select({'selector': '#choice'}, value)
        self.options.append({'index': 3, 'value': 'last', 'disabled': False})
        with self.assertRaises(runtime.BrowserWorkflowError):
            runtime.leon_select({'selector': '#choice'}, 'last')
        runtime._leon_dispatch.assert_not_called()
        runtime.press_key.assert_not_called()

    def test_control_click_requires_focus_not_a_page_text_change(self):
        result = runtime.leon_click({'selector': '#choice'})
        self.assertTrue(result['control_focused'])
        self.assertNotIn('selection_verified', result)
        self.assertIn('document.activeElement', runtime.leon_wait.call_args.args[0])
        runtime._leon_dispatch.assert_called_once()

    def test_failed_verification_never_replays_selection(self):
        runtime.leon_wait.side_effect = [True, TimeoutError('selection changed')]
        with self.assertRaises(TimeoutError):
            runtime.leon_select({'selector': '#choice'}, 'last')
        self.assertFalse(runtime._LEON_ACTIONS[-1]['success'])
        runtime._leon_dispatch.assert_called_once()
        self.assertEqual(runtime.press_key.call_count, 3)


unittest.main()
