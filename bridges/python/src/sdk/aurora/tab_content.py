from typing import TypedDict
from ..widget_component import WidgetComponent


class TabContentProps(TypedDict, total=False):
    pass


class TabContent(WidgetComponent[TabContentProps]):
    def __init__(self, props: TabContentProps):
        super().__init__(props)
