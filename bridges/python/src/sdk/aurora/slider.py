from typing import TypedDict
from ..widget_component import WidgetComponent


class SliderProps(TypedDict, total=False):
    pass


class Slider(WidgetComponent[SliderProps]):
    def __init__(self, props: SliderProps):
        super().__init__(props)
