from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams


def run(params: ActionParams) -> None:
    """Take decision whether to do a rematch"""

    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        leon.answer({
            'key': 'confirm_rematch',
            'core': {
                'isInActionLoop': False,
                'restart': True
            }
        })
        return

    leon.answer({
        'key': 'deny_rematch',
        'core': {
            'isInActionLoop': False
        }
    })
