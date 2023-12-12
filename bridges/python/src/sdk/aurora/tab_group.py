from typing import TypedDict
from ..widget_component import WidgetComponent


class TabGroupProps(TypedDict, total=False):
    pass


class TabGroup(WidgetComponent[TabGroupProps]):
    def __init__(self, props: TabGroupProps):
        super().__init__(props)
