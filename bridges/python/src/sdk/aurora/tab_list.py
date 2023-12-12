from typing import TypedDict
from ..widget_component import WidgetComponent


class TabListProps(TypedDict, total=False):
    pass


class TabList(WidgetComponent[TabListProps]):
    def __init__(self, props: TabListProps):
        super().__init__(props)
