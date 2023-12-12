from typing import TypedDict
from ..widget_component import WidgetComponent


class CheckboxProps(TypedDict, total=False):
    pass


class Checkbox(WidgetComponent[CheckboxProps]):
    def __init__(self, props: CheckboxProps):
        super().__init__(props)
