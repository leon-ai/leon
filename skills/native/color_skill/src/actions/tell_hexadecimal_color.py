from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from ..lib import hexa_colors


def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Leon tells a hexadecimal color code"""

    try:
        color_name = params_helper.get_action_argument('color_name')

        if not color_name:
            return leon.answer({
                'key': 'unknown'
            })
        color_name = str(color_name).lower()

        return leon.answer({
            'key': 'hexa_code_found',
            'data': {
                'color_name': color_name,
                'hexa_code': hexa_colors.MAP[color_name]
            }
        })
    except BaseException:
        return leon.answer({'key': 'not_found'})
