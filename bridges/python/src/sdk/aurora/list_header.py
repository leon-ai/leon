from typing import TypedDict
from ..widget_component import WidgetComponent


class ListHeaderProps(TypedDict, total=False):
    pass


class ListHeader(WidgetComponent[ListHeaderProps]):
    def __init__(self, props: ListHeaderProps):
        super().__init__(props)
