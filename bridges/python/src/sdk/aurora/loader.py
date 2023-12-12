from typing import TypedDict
from ..widget_component import WidgetComponent


class LoaderProps(TypedDict, total=False):
    pass


class Loader(WidgetComponent[LoaderProps]):
    def __init__(self, props: LoaderProps):
        super().__init__(props)
