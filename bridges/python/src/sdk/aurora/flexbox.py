from typing import TypedDict
from ..widget_component import WidgetComponent


class FlexboxProps(TypedDict, total=False):
    pass


class Flexbox(WidgetComponent[FlexboxProps]):
    def __init__(self, props: FlexboxProps):
        super().__init__(props)
