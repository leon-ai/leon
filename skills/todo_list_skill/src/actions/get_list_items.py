from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.todos_list_widget import TodosListWidget
from ..lib import memory

from typing import Union


def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """View a to-do list"""

    widget_id = params_helper.get_widget_id()
    list_name: Union[str, None] = None

    list_name = params_helper.get_action_argument('list_name')

    if list_name is not None:
        list_name = list_name.lower()

        if not memory.has_todo_list(list_name):
            return leon.answer({
                'key': 'list_does_not_exist',
                'data': {
                    'list': list_name
                }
            })

        widget_id = memory.get_todo_list_by_name(list_name)['widget_id']
    else:
        todo_list = memory.get_todo_list_by_widget_id(widget_id)

        if todo_list is None:
            return leon.answer({
                'key': 'list_does_not_exist',
                'data': {
                    'list': list_name
                }
            })

        list_name = memory.get_todo_list_by_widget_id(widget_id)['name']

    todos = memory.get_todo_items(widget_id, list_name)

    if len(todos) == 0:
        return leon.answer({
            'key': 'empty_list',
            'data': {
                'list': list_name
            }
        })

    todos_list_widget = TodosListWidget(
        WidgetOptions(
            wrapper_props={'noPadding': True},
            params={'list_name': list_name, 'todos': todos},
            on_fetch={
                'widget_id': widget_id,
                'action_name': 'get_list_items'
            }
        )
    )

    leon.answer({'widget': todos_list_widget})
