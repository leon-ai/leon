from typing import Optional

from bridges.python.src.sdk.widget import Widget, WidgetOptions
from bridges.python.src.sdk.widget_component import WidgetComponent
from bridges.python.src.sdk.aurora.button import Button

class Params:
    def __init__(self, randon_number: int):
        self.randon_number = randon_number

class NumberWidget(Widget):
    def __init__(self, options: Optional[WidgetOptions[Params]] = None):
        super().__init__(options)

    def render(self) -> WidgetComponent:
        children = 'Click me'

        if self.params:
            children = f"{self.params['random_number']}"

        return Button(children=children)
