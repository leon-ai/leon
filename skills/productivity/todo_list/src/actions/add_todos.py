from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """Add todos to a to-do list"""

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
        memory.create_todo_list(list_name)

    result: str = ''
    for todo in todos:
        memory.create_todo_item(list_name, todo)
        result += str(leon.set_answer_data('list_todo_element', {'todo': todo}))

    leon.answer({
        'key': 'todos_added',
        'data': {
            'list': list_name,
            'result': result
        }
    })
