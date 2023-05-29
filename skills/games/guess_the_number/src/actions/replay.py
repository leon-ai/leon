from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from ..lib import memory


def run(params: ActionParams) -> None:
    """Take decision about whether to replay"""

    memory.game_memory.clear()
    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        leon.answer({
            'key': 'replay',
            'core': {
                'isInActionLoop': False,
                'restart': True
            }
        })
        return

    leon.answer({
        'key': 'stop',
        'core': {
            'isInActionLoop': False
        }
    })
