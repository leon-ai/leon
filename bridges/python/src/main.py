import sys
from traceback import print_exc
from importlib import import_module

from constants import INTENT_OBJECT


def main():
    params = {
        'lang': INTENT_OBJECT['lang'],
        'utterance': INTENT_OBJECT['utterance'],
        'current_entities': INTENT_OBJECT['current_entities'],
        'entities': INTENT_OBJECT['entities'],
        'current_resolvers': INTENT_OBJECT['current_resolvers'],
        'resolvers': INTENT_OBJECT['resolvers'],
        'slots': INTENT_OBJECT['slots'],
        'extra_context_data': INTENT_OBJECT['extra_context_data']
    }

    try:
        sys.path.append('.')

        skill_action_module = import_module(
            'skills.'
            + INTENT_OBJECT['domain']
            + '.'
            + INTENT_OBJECT['skill']
            + '.src.actions.'
            + INTENT_OBJECT['action']
        )

        getattr(skill_action_module, 'run')(params)
    except Exception as e:
        print(f"Error while running {INTENT_OBJECT['skill']} skill {INTENT_OBJECT['action']} action: {e}")
        print_exc()


if __name__ == '__main__':
    try:
        raise main()
    except Exception as e:
        # Print full traceback error report if skills triggers an error from the call stack
        if 'exceptions must derive from BaseException' not in str(e):
            print_exc()
