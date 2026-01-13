from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper


def run(_params: ActionParams, params_helper: ParamsHelper) -> None:
    """Leon tells about partner assistants"""

    try:
        assistant_name = params_helper.get_action_argument('assistant_name').lower()
        leon.answer({
            'key': assistant_name
        })
    except BaseException:
        return leon.answer({'key': 'not_found'})
