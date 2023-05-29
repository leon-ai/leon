from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams


def run(params: ActionParams) -> None:
    """Ask for a retry"""

    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        return leon.answer({
            'key': 'confirm_retry',
            'core': {
                'isInActionLoop': False,
                'restart': True
            }
        })

    leon.answer({
        'key': 'deny_retry',
        'core': {
            'isInActionLoop': False
        }
    })
