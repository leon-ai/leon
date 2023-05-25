from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union


def run(params: ActionParams) -> None:
    """Complete todos"""

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
        for todo_item in memory.get_todo_items(list_name):
            if todo_item['name'].find(todo) != -1:
                memory.complete_todo_item(list_name, todo_item['name'])
                result += str(leon.set_answer_data('list_completed_todo_element', {'todo': todo_item['name']}))

    leon.answer({
        'key': 'todos_completed',
        'data': {
            'list': list_name,
            'result': result
        }
    })
