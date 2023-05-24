import utils
from traceback import print_exc
from sys import path
from json import dumps, loads
from importlib import import_module


def main():
    """Dynamically import skills related to the args and print the output"""

    path.append('.')

    intent_obj = utils.get_intent_obj()

    skill = import_module('skills.' + intent_obj['domain'] + '.' + intent_obj['skill'] + '.src.actions.' + intent_obj['action'])

    params = {
        'lang': intent_obj['lang'],
        'utterance': intent_obj['utterance'],
        'current_entities': intent_obj['current_entities'],
        'entities': intent_obj['entities'],
        'current_resolvers': intent_obj['current_resolvers'],
        'resolvers': intent_obj['resolvers'],
        'slots': intent_obj['slots']
    }

    return getattr(skill, intent_obj['action'])(params)


if __name__ == '__main__':
    try:
        raise main()
    except Exception as e:
        # Print full traceback error report if skills triggers an error from the call stack
        if 'exceptions must derive from BaseException' not in str(e):
            print_exc()
