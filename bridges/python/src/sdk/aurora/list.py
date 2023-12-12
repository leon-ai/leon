from typing import TypedDict
from ..widget_component import WidgetComponent


class ListProps(TypedDict, total=False):
    pass


class List(WidgetComponent[ListProps]):
    def __init__(self, props: ListProps):
        super().__init__(props)
