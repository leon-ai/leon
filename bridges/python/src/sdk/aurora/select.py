from typing import TypedDict
from ..widget_component import WidgetComponent


class SelectProps(TypedDict, total=False):
    pass


class Select(WidgetComponent[SelectProps]):
    def __init__(self, props: SelectProps):
        super().__init__(props)
