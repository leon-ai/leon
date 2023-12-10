# from leon_ai.aurora import WidgetWrapperProps
from typing import Any, Optional
from ..widget_component import WidgetComponent


class WidgetWrapperProps:
    def __init__(
        self,
        children: Any,
        noPadding: Optional[bool] = False,
        paddingTop: Optional[bool] = False,
        paddingBottom: Optional[bool] = False,
        paddingLeft: Optional[bool] = False,
        paddingRight: Optional[bool] = False,
    ):
        self.children = children
        self.noPadding = noPadding
        self.paddingTop = paddingTop
        self.paddingBottom = paddingBottom
        self.paddingLeft = paddingLeft
        self.paddingRight = paddingRight


class WidgetWrapper(WidgetComponent[WidgetWrapperProps]):
    def __init__(self, props: WidgetWrapperProps):
        super().__init__(props)
