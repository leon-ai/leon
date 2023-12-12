from typing import TypedDict
from ..widget_component import WidgetComponent


class ProgressProps(TypedDict, total=False):
    pass


class Progress(WidgetComponent[ProgressProps]):
    def __init__(self, props: ProgressProps):
        super().__init__(props)
