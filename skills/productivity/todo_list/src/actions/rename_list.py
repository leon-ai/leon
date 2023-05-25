from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """Rename a to-do list"""

    old_list_name: Union[str, None] = None
    new_list_name: Union[str, None] = None

    for item in params['entities']:
        if item['entity'] == 'old_list':
            old_list_name = item['sourceText'].lower()
        elif item['entity'] == 'new_list':
            new_list_name = item['sourceText'].lower()

    if old_list_name is None or new_list_name is None:
        return leon.answer({'key': 'new_or_old_list_not_provided'})

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
