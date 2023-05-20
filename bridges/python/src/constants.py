import sys
import json
import os

INTENT_OBJ_FILE_PATH = sys.argv[1]

with open(INTENT_OBJ_FILE_PATH, 'r') as f:
    INTENT_OBJECT = json.load(f)

SKILLS_ROOT_PATH = os.path.join(
	os.getcwd(),
	'skills'
)

SKILL_PATH = os.path.join(
	SKILLS_ROOT_PATH,
	INTENT_OBJECT['domain'],
	INTENT_OBJECT['skill']
)

SKILLS_PATH = SKILLS_ROOT_PATH

with open(os.path.join(SKILL_PATH, 'config', INTENT_OBJECT['extra_context_data']['lang'] + '.json'), 'r') as f:
    SKILL_CONFIG = json.load(f)

with open(os.path.join(SKILL_PATH, 'src', 'config.json'), 'r') as f:
	SKILL_SRC_CONFIG = json.load(f)['configurations']

