import sys
import json
import os

import version

INTENT_OBJ_FILE_PATH = sys.argv[1]

with open(INTENT_OBJ_FILE_PATH, 'r', encoding='utf-8') as f:
    INTENT_OBJECT = json.load(f)

SKILLS_ROOT_PATH = os.path.join(
    os.getcwd(),
    'skills'
)
BIN_PATH = os.path.join(
    os.getcwd(),
    'bin'
)
BRIDGES_PATH = os.path.join(
    os.getcwd(),
    'bridges'
)

CUDA_RUNTIME_PATH = os.path.join(BIN_PATH, 'cuda')

TOOLKITS_PATH = os.path.join(BRIDGES_PATH, 'toolkits')

SKILL_PATH = os.path.join(
    SKILLS_ROOT_PATH,
    INTENT_OBJECT['skill_name']
)

SKILLS_PATH = SKILLS_ROOT_PATH

SKILL_LOCALE_PATH = os.path.join(
    SKILL_PATH,
    'locales',
    f"{INTENT_OBJECT['extra_context']['lang']}.json"
)
if os.path.exists(SKILL_LOCALE_PATH):
    with open(SKILL_LOCALE_PATH, 'r', encoding='utf-8') as f:
        SKILL_LOCALE_CONFIG_CONTENT = json.load(f)
else:
    SKILL_LOCALE_CONFIG_CONTENT = {
        'variables': {},
        'common_answers': {},
        'widget_contents': {},
        'actions': {
            INTENT_OBJECT['action_name']: {}
        }
    }

SKILL_LOCALE_CONFIG = SKILL_LOCALE_CONFIG_CONTENT.get('actions', {}).get(INTENT_OBJECT['action_name'], {}).copy()
SKILL_LOCALE_CONFIG['variables'] = SKILL_LOCALE_CONFIG_CONTENT.get('variables', {})
SKILL_LOCALE_CONFIG['common_answers'] = SKILL_LOCALE_CONFIG_CONTENT.get('common_answers', {})
SKILL_LOCALE_CONFIG['widget_contents'] = SKILL_LOCALE_CONFIG_CONTENT.get('widget_contents', {})

LEON_VERSION = os.getenv('npm_package_version')

PYTHON_BRIDGE_VERSION = version.__version__
