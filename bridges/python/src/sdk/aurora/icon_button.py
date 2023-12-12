from typing import TypedDict
from ..widget_component import WidgetComponent


class IconButtonProps(TypedDict, total=False):
    pass


class IconButton(WidgetComponent[IconButtonProps]):
    def __init__(self, props: IconButtonProps):
        super().__init__(props)
