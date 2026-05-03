import sys
import json
import os

import version

DEFAULT_LEON_PROFILE = "just-me"
LEON_HOME_DIRNAME = ".leon"


argv = sys.argv[1:]
if "--runtime" in argv:
    runtime_index = argv.index("--runtime")
    argv = [
        arg
        for index, arg in enumerate(argv)
        if index not in (runtime_index, runtime_index + 1)
    ]

INTENT_OBJ_FILE_PATH = argv[0] if argv else None
if not INTENT_OBJ_FILE_PATH:
    raise Exception("Missing intent object path for skill runtime.")

with open(INTENT_OBJ_FILE_PATH, "r", encoding="utf-8") as f:
    INTENT_OBJECT = json.load(f)

CODEBASE_PATH = os.path.abspath(
    os.getenv("LEON_CODEBASE_PATH", "").strip() or os.getcwd()
)
LEON_HOME_PATH = os.path.abspath(
    os.getenv("LEON_HOME", "").strip()
    or os.path.join(os.path.expanduser("~"), LEON_HOME_DIRNAME)
)
LEON_PROFILE_NAME = os.getenv("LEON_PROFILE", "").strip() or DEFAULT_LEON_PROFILE
LEON_PROFILES_PATH = os.path.join(LEON_HOME_PATH, "profiles")
LEON_PROFILE_PATH = os.path.join(LEON_PROFILES_PATH, LEON_PROFILE_NAME)
LEON_TOOLKITS_PATH = os.path.join(LEON_HOME_PATH, "toolkits")
PROFILE_CONTEXT_PATH = os.path.join(LEON_PROFILE_PATH, "context")
PROFILE_MEMORY_PATH = os.path.join(LEON_PROFILE_PATH, "memory")
PROFILE_MEMORY_DB_PATH = os.path.join(PROFILE_MEMORY_PATH, "index.sqlite")
PROFILE_SKILLS_PATH = os.path.join(LEON_PROFILE_PATH, "skills")
PROFILE_NATIVE_SKILLS_PATH = os.path.join(PROFILE_SKILLS_PATH, "native")
PROFILE_AGENT_SKILLS_PATH = os.path.join(PROFILE_SKILLS_PATH, "agent")
PROFILE_TOOLS_PATH = os.path.join(LEON_PROFILE_PATH, "tools")
PROFILE_DISABLED_PATH = os.path.join(LEON_PROFILE_PATH, "disabled.json")

SKILLS_ROOT_PATH = os.path.join(CODEBASE_PATH, "skills")
NATIVE_SKILLS_PATH = os.path.join(SKILLS_ROOT_PATH, "native")
AGENT_SKILLS_PATH = os.path.join(SKILLS_ROOT_PATH, "agent")
TOOLS_PATH = os.path.join(CODEBASE_PATH, "tools")
BIN_PATH = os.path.join(LEON_HOME_PATH, "bin")
BRIDGES_PATH = os.path.join(CODEBASE_PATH, "bridges")

NVIDIA_LIBS_PATH = os.path.join(BIN_PATH, "nvidia")

PYTORCH_PATH = os.path.join(BIN_PATH, "pytorch")
PYTORCH_TORCH_PATH = os.path.join(PYTORCH_PATH, "torch")

SKILL_PATH = os.path.dirname(INTENT_OBJECT["skill_config_path"])

SKILLS_PATH = SKILLS_ROOT_PATH

SKILL_LOCALE_PATH = os.path.join(
    SKILL_PATH, "locales", f"{INTENT_OBJECT['extra_context']['lang']}.json"
)
if INTENT_OBJECT["skill_name"] and os.path.exists(SKILL_LOCALE_PATH):
    with open(SKILL_LOCALE_PATH, "r", encoding="utf-8") as f:
        SKILL_LOCALE_CONFIG_CONTENT = json.load(f)
else:
    SKILL_LOCALE_CONFIG_CONTENT = {
        "variables": {},
        "common_answers": {},
        "widget_contents": {},
        "actions": {INTENT_OBJECT["action_name"]: {}},
    }

SKILL_LOCALE_CONFIG = (
    SKILL_LOCALE_CONFIG_CONTENT.get("actions", {})
    .get(INTENT_OBJECT["action_name"], {})
    .copy()
)
SKILL_LOCALE_CONFIG["variables"] = SKILL_LOCALE_CONFIG_CONTENT.get("variables", {})
SKILL_LOCALE_CONFIG["common_answers"] = SKILL_LOCALE_CONFIG_CONTENT.get(
    "common_answers", {}
)
SKILL_LOCALE_CONFIG["widget_contents"] = SKILL_LOCALE_CONFIG_CONTENT.get(
    "widget_contents", {}
)

LEON_VERSION = os.getenv("npm_package_version")

PYTHON_BRIDGE_VERSION = version.__version__
