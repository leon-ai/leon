from typing import TypedDict
from ..widget_component import WidgetComponent


class ImageProps(TypedDict, total=False):
    pass


class Image(WidgetComponent[ImageProps]):
    def __init__(self, props: ImageProps):
        super().__init__(props)
