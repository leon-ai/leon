from typing import TypedDict
from ..widget_component import WidgetComponent


class IconProps(TypedDict, total=False):
    pass


class Icon(WidgetComponent[IconProps]):
    def __init__(self, props: IconProps):
        super().__init__(props)
