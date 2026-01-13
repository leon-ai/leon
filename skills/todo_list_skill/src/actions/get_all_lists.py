from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.widget import WidgetOptions
from ..lib import memory

from ..widgets.list_of_lists_widget import ListOfListsWidget, ListOfListsWidgetParams


def run(params: ActionParams) -> None:
    """View to-do lists"""

    todo_lists_count = memory.count_todo_lists()

    if todo_lists_count == 0:
        return leon.answer({'key': 'no_list'})

    list_names: list[str] = []
    for list_element in memory.get_todo_lists():
        list_names.append(list_element['name'])

    list_of_lists_options: WidgetOptions[ListOfListsWidgetParams] = WidgetOptions(
        wrapper_props={'noPadding': True},
        params={'list_names': list_names}
    )
    list_of_lists_widget = ListOfListsWidget(list_of_lists_options)

    leon.answer({'widget': list_of_lists_widget})
