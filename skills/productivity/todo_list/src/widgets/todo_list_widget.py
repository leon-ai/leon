from typing import TypedDict
from bridges.python.src.sdk.aurora.list import List
from bridges.python.src.sdk.aurora.list_header import ListHeader
from bridges.python.src.sdk.aurora.list_item import ListItem
from bridges.python.src.sdk.aurora.checkbox import Checkbox

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent
from skills.productivity.todo_list.src.lib.memory import TodoItem


class TodoListWidgetParams(TypedDict):
    list_name: str
    todo_items: list[TodoItem]


class TodoListWidget(Widget[TodoListWidgetParams]):
    def __init__(self, options: WidgetOptions[TodoListWidgetParams]):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        todo_items = self.params['todo_items']
        list_name = self.params['list_name']
        return List({
            'children': [
                ListHeader({
                    'children': list_name
                }),
                *[
                    ListItem({
                        'children': [
                            Checkbox({
                                'label': todo_item['name'],
                                'value': todo_item['name'],
                                'checked': todo_item['is_completed'],
                            })
                        ]
                    }) for todo_item in todo_items
                ]
            ]
        })
