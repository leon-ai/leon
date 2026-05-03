from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from ..lib import memory

from typing import Union


def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Rename a to-do list"""

    old_list_name: Union[str, None] = None
    new_list_name: Union[str, None] = None

    old_list_name = params_helper.get_action_argument('old_list_name').lower()
    new_list_name = params_helper.get_action_argument('new_list_name').lower()

    if not memory.has_todo_list(old_list_name):
        return leon.answer({
            'key': 'list_does_not_exist',
            'data': {
                'list': old_list_name
            }
        })

    if memory.has_todo_list(new_list_name):
        return leon.answer({
            'key': 'list_already_exists',
            'data': {
                'list': new_list_name
            }
        })

    memory.update_todo_list(old_list_name, new_list_name)

    leon.answer({
        'key': 'list_renamed',
        'data': {
            'old_list': old_list_name,
            'new_list': new_list_name
        }
    })
