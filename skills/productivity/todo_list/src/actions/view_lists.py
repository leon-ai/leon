from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """View to-do lists"""

    todo_lists_count = memory.count_todo_lists()

    if todo_lists_count == 0:
        return leon.answer({'key': 'no_list'})

    result: str = ''
    for list_element in memory.get_todo_lists():
        result += str(leon.set_answer_data('list_list_element', {
            'list': list_element['name'],
            'todos_nb': memory.count_todo_items(list_element['name'])
        }))

    leon.answer({
        'key': 'lists_listed',
        'data': {
            'lists_nb': todo_lists_count,
            'result': result
        }
    })
