from typing import TypedDict
from ..widget_component import WidgetComponent


class LinkProps(TypedDict, total=False):
    pass


class Link(WidgetComponent[LinkProps]):
    def __init__(self, props: LinkProps):
        super().__init__(props)
