from typing import TypedDict
from bridges.python.src.sdk.aurora.list import List
from bridges.python.src.sdk.aurora.list_item import ListItem
from bridges.python.src.sdk.aurora.text import Text

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent


class ListOfListsWidgetParams(TypedDict):
    list_names: list[str]


class ListOfListsWidget(Widget[ListOfListsWidgetParams]):
    def __init__(self, options: WidgetOptions[ListOfListsWidgetParams]):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        list_items = []
        for list_name in self.params['list_names']:
            list_items.append(ListItem({
                'children': [Text({
                    'fontWeight': 'semi-bold',
                    'children': list_name
                })],
                'align': 'left',
                'onClick': self.run_skill_action('todo_list_skill:get_list_items', {
                    'action_arguments': {
                        'list_name': list_name
                    }
                })
            }))

        return List({
            'children': [
                *list_items
            ]
        })
