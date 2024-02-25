from typing import Optional, TypedDict, Union, Literal, Any
from ..widget_component import WidgetComponent


class ButtonProps(TypedDict, total=False):
    type: Optional[Union[Literal['button'], Literal['submit'], Literal['reset']]]
    iconName: Optional[str]
    iconPosition: Optional[Union[Literal['left'], Literal['right']]]
    secondary: Optional[bool]
    danger: Optional[bool]
    light: Optional[bool]
    disabled: Optional[bool]
    loading: Optional[bool]
    children: Any


class Button(WidgetComponent[ButtonProps]):
    def __init__(self, props: ButtonProps):
        super().__init__(props)
