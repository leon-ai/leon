from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.todos_list_widget import TodosListWidget, TodosListWidgetParams
from ..lib import memory

from typing import Union


def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Uncheck todos"""

    list_name: Union[str, None] = None
    todos: list[str] = []

    list_name = params_helper.get_action_argument('list_name').lower()
    todos = params_helper.get_action_argument('items')

    if not memory.has_todo_list(list_name):
        return leon.answer({
            'key': 'list_does_not_exist',
            'data': {
                'list': list_name
            }
        })

    for todo in todos:
        for todo_item in memory.get_todo_items(None, list_name):
            if todo_item['name'].find(todo) != -1:
                memory.toggle_todo_item(list_name, todo_item['name'])

    # Get the updated list of todos
    list_todos = memory.get_todo_items(None, list_name)

    todos_list_options: WidgetOptions[TodosListWidgetParams] = WidgetOptions(
        wrapper_props={'noPadding': True},
        params={'list_name': list_name, 'todos': list_todos},
        on_fetch={
            'widget_id': list_todos[0]['widget_id'],
            'action_name': 'get_list_items'
        }
    )
    todos_list_widget = TodosListWidget(todos_list_options)

    leon.answer({'widget': todos_list_widget})
