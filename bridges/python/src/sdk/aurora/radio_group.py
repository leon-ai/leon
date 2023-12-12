from typing import TypedDict
from ..widget_component import WidgetComponent


class RadioGroupProps(TypedDict, total=False):
    pass


class RadioGroup(WidgetComponent[RadioGroupProps]):
    def __init__(self, props: RadioGroupProps):
        super().__init__(props)
