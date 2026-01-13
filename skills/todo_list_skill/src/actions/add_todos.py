from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.todos_list_widget import TodosListWidget, TodosListWidgetParams
from ..lib import memory

from typing import Union

def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Add todos to a to-do list"""

    list_name: Union[str, None] = None
    todos: list[str] = []

    list_name = params_helper.get_action_argument('list_name').lower()
    todos = params_helper.get_action_argument('items')

    widget_id = None
    if not memory.has_todo_list(list_name):
        todos_list_widget = TodosListWidget(WidgetOptions())
        widget_id = todos_list_widget.id
        memory.create_todo_list(
            widget_id,
            list_name
        )
        memory.create_todo_list(widget_id, list_name)
    else:
        widget_id = memory.get_todo_list_by_name(list_name)['widget_id']

    result: str = ''
    for todo in todos:
        memory.create_todo_item(widget_id, list_name, todo)
        result += str(leon.set_answer_data('list_todo_element', {'todo': todo}))


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
