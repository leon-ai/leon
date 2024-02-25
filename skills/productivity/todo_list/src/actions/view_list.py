from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.todo_list_widget import TodoListWidget, TodoListWidgetParams
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

    todo_list_widget_options: WidgetOptions[TodoListWidgetParams] = WidgetOptions(
        wrapper_props={
            'noPadding': True
        },
        params={
            'list_name': list_name,
            'todo_items': todos,
        },
    )
    todo_list_widget = TodoListWidget(todo_list_widget_options)
    leon.answer({
        'widget': todo_list_widget
    })
