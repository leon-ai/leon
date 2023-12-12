from typing import TypedDict
from ..widget_component import WidgetComponent


class SwitchProps(TypedDict, total=False):
    pass


class Switch(WidgetComponent[SwitchProps]):
    def __init__(self, props: SwitchProps):
        super().__init__(props)
