from typing import TypedDict
from ..widget_component import WidgetComponent


class TabProps(TypedDict, total=False):
    pass


class Tab(WidgetComponent[TabProps]):
    def __init__(self, props: TabProps):
        super().__init__(props)
