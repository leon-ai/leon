from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.params_helper import ParamsHelper
from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.todos_list_widget import TodosListWidget
from ..lib import memory

def run(params: ActionParams, params_helper: ParamsHelper) -> None:
    """Create a to-do list"""

    list_name = params_helper.get_action_argument('list_name').lower()

    if memory.has_todo_list(list_name):
        return leon.answer({
            'key': 'list_already_exists',
            'data': {
                'list': list_name
            }
        })

    todos_list_widget = TodosListWidget(WidgetOptions())
    memory.create_todo_list(
        todos_list_widget.id,
        list_name
    )

    leon.answer({
        'key': 'list_created',
        'data': {
            'list': list_name
        }
    })
