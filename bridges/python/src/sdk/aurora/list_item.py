from typing import TypedDict
from ..widget_component import WidgetComponent


class ListItemProps(TypedDict, total=False):
    pass


class ListItem(WidgetComponent[ListItemProps]):
    def __init__(self, props: ListItemProps):
        super().__init__(props)
