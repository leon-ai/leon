from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper

from ..lib import memory


def run(_params: ActionParams, params_helper: ParamsHelper) -> None:
    """Take decision about whether to replay"""

    memory.game_memory.clear()

    confirmation = params_helper.get_action_argument('confirmation')

    if confirmation is not None and confirmation.lower() == 'true':
        leon.answer({
            'key': 'replay',
            'core': {
                'is_in_action_loop': False,
                'next_action': 'guess_the_number_skill:set_up'
            }
        })
        return

    leon.answer({
        'key': 'stop',
        'core': {
            'is_in_action_loop': False
        }
    })
