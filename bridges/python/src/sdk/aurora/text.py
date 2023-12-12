from typing import TypedDict
from ..widget_component import WidgetComponent


class TextProps(TypedDict, total=False):
    pass


class Text(WidgetComponent[TextProps]):
    def __init__(self, props: TextProps):
        super().__init__(props)
