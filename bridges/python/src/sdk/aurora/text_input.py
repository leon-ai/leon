from typing import TypedDict
from ..widget_component import WidgetComponent


class TextInputProps(TypedDict, total=False):
    pass


class TextInput(WidgetComponent[TextInputProps]):
    def __init__(self, props: TextInputProps):
        super().__init__(props)
