import sys
import os
import inspect
from traceback import print_exc
from importlib import util

from constants import INTENT_OBJECT, SKILL_PATH
from sdk.params_helper import ParamsHelper


# Mirror the Node bridge loader so Python actions can expose `run`,
# `default.run`, or a callable `default`.
def resolve_action_function(skill_action_module):
    run_function = getattr(skill_action_module, 'run', None)
    if callable(run_function):
        return run_function

    default_export = getattr(skill_action_module, 'default', None)
    default_run_function = getattr(default_export, 'run', None)
    if callable(default_run_function):
        return default_run_function

    if callable(default_export):
        return default_export

    return None


def get_skill_venv_site_packages_path():
    venv_path = os.path.join(SKILL_PATH, 'src', '.venv')
    candidates = [
        os.path.join(
            venv_path,
            'Lib',
            'site-packages'
        ),
        os.path.join(
            venv_path,
            'lib',
            f'python{sys.version_info.major}.{sys.version_info.minor}',
            'site-packages'
        )
    ]

    for candidate in candidates:
        if os.path.isdir(candidate):
            return os.path.abspath(candidate)

    return None


def main():
    skill_site_packages_path = get_skill_venv_site_packages_path()

    if skill_site_packages_path:
        sys.path.insert(0, skill_site_packages_path)

    params = {
        'lang': INTENT_OBJECT['lang'],
        'utterance': INTENT_OBJECT['utterance'],
        'action_arguments': INTENT_OBJECT['action_arguments'],
        'entities': INTENT_OBJECT['entities'],
        'sentiment': INTENT_OBJECT['sentiment'],
        'context_name': INTENT_OBJECT['context_name'],
        'skill_name': INTENT_OBJECT['skill_name'],
        'action_name': INTENT_OBJECT['action_name'],
        'context': INTENT_OBJECT['context'],
        'skill_config': INTENT_OBJECT['skill_config'],
        'skill_config_path': INTENT_OBJECT['skill_config_path'],
        'extra_context': INTENT_OBJECT['extra_context']
    }

    try:
        sys.path.append('.')
        sys.path.insert(0, os.path.dirname(SKILL_PATH))

        action_path = os.path.join(
            SKILL_PATH,
            'src',
            'actions',
            INTENT_OBJECT['action_name'] + '.py'
        )
        spec = util.spec_from_file_location(
            INTENT_OBJECT['skill_name']
            + '.src.actions.'
            + INTENT_OBJECT['action_name'],
            action_path
        )
        if spec is None or spec.loader is None:
            raise ImportError(f'Cannot load action module from "{action_path}"')

        skill_action_module = util.module_from_spec(spec)
        spec.loader.exec_module(skill_action_module)

        run_function = resolve_action_function(skill_action_module)
        if not callable(run_function):
            raise TypeError(
                f'Action "{INTENT_OBJECT["skill_name"]}:{INTENT_OBJECT["action_name"]}" '
                'does not export a runnable action function'
            )

        params_helper = ParamsHelper(params)

        # Inspect to decide how many args to pass
        signature = inspect.signature(run_function)
        param_count = len(signature.parameters)

        if param_count >= 2:
            run_function(params, params_helper)
        elif param_count == 1:
            run_function(params)
        else:
            run_function()
    except Exception as e:
        print(f"Error while running {INTENT_OBJECT['skill_name']} skill {INTENT_OBJECT['action_name']} action: {e}")
        print_exc()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Print full traceback error report if skills triggers an error from the call stack.
        print_exc()
