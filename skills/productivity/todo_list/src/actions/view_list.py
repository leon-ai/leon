from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """View a to-do list"""

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

    todos = memory.get_todo_items(list_name)

    if len(todos) == 0:
        return leon.answer({
            'key': 'empty_list',
            'data': {
                'list': list_name
            }
        })

    uncompleted_todos = memory.get_uncompleted_todo_items(list_name)
    completed_todos = memory.get_completed_todo_items(list_name)

    result_uncompleted_todos: str = ''
    result_completed_todos: str = ''

    if len(uncompleted_todos) == 0:
        leon.answer({
            'key': 'no_unchecked_todo',
            'data': {
                'list': list_name
            }
        })
    else:
        for todo in uncompleted_todos:
            result_uncompleted_todos += str(leon.set_answer_data('list_todo_element', {'todo': todo['name']}))

        leon.answer({
            'key': 'unchecked_todos_listed',
            'data': {
                'list': list_name,
                'result': result_uncompleted_todos
            }
        })

    if len(completed_todos) == 0:
        return leon.answer({
            'key': 'no_completed_todo',
            'data': {
                'list': list_name
            }
        })

    for todo in completed_todos:
        result_completed_todos += str(leon.set_answer_data('list_completed_todo_element', {'todo': todo['name']}))

    leon.answer({
        'key': 'completed_todos_listed',
        'data': {
            'list': list_name,
            'result': result_completed_todos
        }
    })
