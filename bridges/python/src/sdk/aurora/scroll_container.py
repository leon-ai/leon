from typing import TypedDict
from ..widget_component import WidgetComponent


class ScrollContainerProps(TypedDict, total=False):
    pass


class ScrollContainer(WidgetComponent[ScrollContainerProps]):
    def __init__(self, props: ScrollContainerProps):
        super().__init__(props)
