from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper


def run(_params: ActionParams, params_helper: ParamsHelper) -> None:
    """Take decision whether to do a rematch"""

    confirmation = params_helper.get_action_argument('confirmation')

    if confirmation is not None and confirmation.lower() == 'true':
        leon.answer({
            'key': 'confirm_rematch',
            'core': {
                'is_in_action_loop': False,
                'next_action': 'rochambeau_skill:set_up'
            }
        })
        return

    leon.answer({
        'key': 'deny_rematch',
        'core': {
            'is_in_action_loop': False
        }
    })
