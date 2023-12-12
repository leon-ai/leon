from typing import TypedDict
from ..widget_component import WidgetComponent


class RadioProps(TypedDict, total=False):
    pass


class Radio(WidgetComponent[RadioProps]):
    def __init__(self, props: RadioProps):
        super().__init__(props)
