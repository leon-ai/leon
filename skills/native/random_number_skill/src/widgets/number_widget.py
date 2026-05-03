from typing import TypedDict
from bridges.python.src.sdk.aurora.text import Text
from bridges.python.src.sdk.aurora.flexbox import Flexbox

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent


class NumberWidgetParams(TypedDict):
    random_number: int


class NumberWidget(Widget[NumberWidgetParams]):
    def __init__(self, options: WidgetOptions[NumberWidgetParams]):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        return Flexbox({
            'alignItems': 'center',
            'justifyContent': 'center',
            'children': [
                Text({
                    'children': self.params.get('random_number'),
                    'fontSize': 'xl'
                })
            ]
        })
