from typing import TypedDict
from bridges.python.src.sdk.aurora.button import Button

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent

class NumberWidgetParams(TypedDict):
    random_number: int


class NumberWidget(Widget[NumberWidgetParams]):
    def __init__(self, options: WidgetOptions[NumberWidgetParams]):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        return Button({
            'children': self.params.get('random_number')
        })
