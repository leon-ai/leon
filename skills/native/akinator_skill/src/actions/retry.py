from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.params_helper import ParamsHelper
from bridges.python.src.sdk.types import ActionParams


def run(_params: ActionParams, params_helper: ParamsHelper) -> None:
    """Confirm whether another Akinator round should start."""

    confirmation = params_helper.get_action_argument('confirmation')
    normalized_confirmation = confirmation

    if isinstance(confirmation, str):
        normalized_confirmation = confirmation.lower() == 'true'

    if normalized_confirmation is True:
        leon.answer({
            'core': {
                'is_in_action_loop': False,
                'next_action': 'akinator_skill:restart_game'
            }
        })
        return

    leon.answer({
        'key': 'deny_retry',
        'core': {
            'is_in_action_loop': False
        }
    })
