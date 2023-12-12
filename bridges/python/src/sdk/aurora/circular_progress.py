from typing import TypedDict
from ..widget_component import WidgetComponent


class CircularProgressProps(TypedDict, total=False):
    pass


class CircularProgress(WidgetComponent[CircularProgressProps]):
    def __init__(self, props: CircularProgressProps):
        super().__init__(props)
