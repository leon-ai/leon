from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """Delete a to-do list"""

    list_name: Union[str, None] = None

    for item in params['entities']:
        if item['entity'] == 'list':
            list_name = item['sourceText'].lower()

    if list_name is None:
        return leon.answer({'key': 'list_not_provided'})

    if not memory.has_todo_list(list_name):
        return leon.answer({
            'key': 'list_does_not_exist',
            'data': {
                'list': list_name
            }
        })

    memory.delete_todo_list(list_name)

    leon.answer({
        'key': 'list_deleted',
        'data': {
            'list': list_name
        }
    })
