from typing import TypedDict
from bridges.python.src.sdk.aurora.list import List
from bridges.python.src.sdk.aurora.list_header import ListHeader
from bridges.python.src.sdk.aurora.list_item import ListItem
from bridges.python.src.sdk.aurora.text import Text
from bridges.python.src.sdk.aurora.checkbox import Checkbox

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent

class TodoType(TypedDict):
    name: str
    is_completed: bool


class TodosListWidgetParams(TypedDict):
    id: str
    list_name: str
    todos: list[TodoType]


class TodosListWidget(Widget[TodosListWidgetParams]):
    def __init__(self, options: WidgetOptions[TodosListWidgetParams]):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        list_items = []
        for todo in self.params['todos']:
            action_name = 'uncomplete_items' if todo['is_completed'] else 'complete_items'
            list_items.append(ListItem({
                'children': [Checkbox({
                    'label': todo['name'],
                    'checked': todo['is_completed'],
                    'onChange': self.run_skill_action(f'todo_list_skill:{action_name}', {
                        'action_arguments': {
                            'list_name': self.params['list_name'],
                            'items': [todo['name']]
                        }
                    })
                })],
                'align': 'left'
            }))

        return List({
            'children': [
                ListHeader({
                    'children': [Text({
                        'fontWeight': 'semi-bold',
                        'children': self.params['list_name']
                    })]
                }),
                *list_items
            ]
        })
