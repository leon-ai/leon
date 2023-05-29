from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """Uncheck todos"""

    list_name: Union[str, None] = None
    todos: list[str] = []

    for item in params['entities']:
        if item['entity'] == 'list':
            list_name = item['sourceText'].lower()
        elif item['entity'] == 'todos':
            todos = [chunk.strip() for chunk in item['sourceText'].lower().split(',')]

    if list_name is None:
        return leon.answer({'key': 'list_not_provided'})

    if len(todos) == 0:
        return leon.answer({'key': 'todos_not_provided'})

    if not memory.has_todo_list(list_name):
        return leon.answer({
            'key': 'list_does_not_exist',
            'data': {
                'list': list_name
            }
        })

    result: str = ''
    for todo in todos:
        for todo_item in memory.get_todo_items(list_name):
            if todo_item['name'].find(todo) != -1:
                memory.uncomplete_todo_item(list_name, todo_item['name'])
                result += str(leon.set_answer_data('list_todo_element', {'todo': todo_item['name']}))

    leon.answer({
        'key': 'todos_unchecked',
        'data': {
            'list': list_name,
            'result': result
        }
    })
