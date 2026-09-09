"""Exercise Python SDK behavior with isolated profiles and no owner state."""

import base64
import json
import os
from pathlib import Path
import sys
import tempfile
from threading import Event, Thread
import unittest

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = tempfile.TemporaryDirectory(prefix="leon-python-sdk-")
FIXTURE_ROOT = Path(FIXTURE.name)
INTENT = FIXTURE_ROOT / "intent.json"
INTENT.write_text(json.dumps({
    "skill_config_path": str(FIXTURE_ROOT / "skill.json"),
    "extra_context": {"lang": "en"},
    "skill_name": "",
    "action_name": "fixture",
}))
os.environ["LEON_HOME"] = str(FIXTURE_ROOT / "home")
os.environ["LEON_CODEBASE_PATH"] = str(FIXTURE_ROOT)
sys.path[:0] = [str(ROOT), str(ROOT / "bridges/python/src")]
sys.argv = [sys.argv[0], str(INTENT)]

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.tool_runtime_types import ToolExecutionContext
from bridges.python.src.sdk.toolkit_config import ToolkitConfig, resolve_tool_directory


class FixtureTool(BaseTool):
    tool_name = "fixture"
    toolkit = "fixture"
    description = "SDK fixture"


class ToolSDKTest(unittest.TestCase):
    def test_execution_context_and_attachments_are_per_call(self):
        tool = FixtureTool()
        signal = Event()
        progress = []
        context = ToolExecutionContext("fixture", "fixture", "run", {}, "a", "one", signal, progress.append)
        tool.prepare_execution(context)
        evidence = FIXTURE_ROOT / "evidence.bin"
        evidence.write_bytes(b"\x00\xffverified")
        tool._attach_model_file(str(evidence), "application/octet-stream")
        tool._attach_model_files([{"dataBase64": "eA==", "mediaType": "text/plain", "visualDetail": "low"}])
        files = tool.get_model_files()
        self.assertEqual(base64.b64decode(files[0]["dataBase64"]), evidence.read_bytes())
        self.assertEqual(files[0]["filename"], evidence.name)
        self.assertEqual(len(files), 2)
        context.on_progress({"source": "log", "message": "working"})
        self.assertEqual(progress[0]["message"], "working")
        canceled = []
        waiter = Thread(target=lambda: canceled.append(tool.execution_context.signal.wait(1)))
        waiter.start()
        signal.set()
        waiter.join()
        self.assertEqual(canceled, [True])
        self.assertTrue(tool.execution_context.signal.is_set())
        tool.prepare_execution(ToolExecutionContext("fixture", "fixture", "run", {}, "b", "two"))
        self.assertEqual(tool.get_model_files(), [])
        self.assertEqual(tool.execution_context.profile_name, "b")
        self.assertEqual(tool.execution_context.conversation_session_id, "two")
        self.assertIsNone(tool.execution_context.signal)

    def test_layout_and_settings_refresh_preserve_owner_values_and_profiles(self):
        root = FIXTURE_ROOT / "tools"
        flat = root / "fixture"
        flat.mkdir(parents=True)
        (flat / "toolkit.json").write_text(json.dumps({"name": "fixture", "tools": ["cli"]}))
        manifest = {"toolkit_id": "fixture", "tool_id": "cli"}
        (flat / "tool.json").write_text(json.dumps(manifest))
        (flat / "settings.sample.json").write_text(json.dumps({"enabled": True, "nested": {"added": 1}}))
        self.assertEqual(resolve_tool_directory(str(root), "fixture", "cli"), str(flat))
        self.assertEqual(ToolkitConfig.load("fixture", "cli"), manifest)
        self.assertEqual(resolve_tool_directory(str(root), "fixture", "other"), str(flat / "other"))
        nested = flat / "cli"
        nested.mkdir()
        (nested / "tool.json").write_text(json.dumps(manifest))
        self.assertEqual(resolve_tool_directory(str(root), "fixture", "cli"), str(nested))
        (nested / "tool.json").unlink()
        settings = FIXTURE_ROOT / "home/profiles/a/tools/fixture/cli/settings.json"
        settings.parent.mkdir(parents=True)
        settings.write_text(json.dumps({"enabled": False, "nested": {"owner": 2}}))
        first = ToolkitConfig.load_tool_settings("fixture", "cli", profile_name="a")
        self.assertEqual(first, {"enabled": False, "nested": {"owner": 2, "added": 1}})
        settings.write_text(json.dumps({"enabled": "edited"}))
        self.assertEqual(ToolkitConfig.load_tool_settings("fixture", "cli", profile_name="a"), first)
        self.assertEqual(ToolkitConfig.load_tool_settings("fixture", "cli", refresh=True, profile_name="a")["enabled"], "edited")
        self.assertTrue(ToolkitConfig.load_tool_settings("fixture", "cli", profile_name="b")["enabled"])
        for invalid in ("..", "../a", "a\\b", "a:b", " "):
            with self.assertRaises(ValueError):
                ToolkitConfig.load_tool_settings("fixture", "cli", profile_name=invalid)



if __name__ == "__main__":
    try:
        unittest.main(argv=[sys.argv[0]])
    finally:
        FIXTURE.cleanup()
