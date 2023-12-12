from typing import TypedDict
from ..widget_component import WidgetComponent


class SelectOptionProps(TypedDict, total=False):
    pass


class SelectOption(WidgetComponent[SelectOptionProps]):
    def __init__(self, props: SelectOptionProps):
        super().__init__(props)
