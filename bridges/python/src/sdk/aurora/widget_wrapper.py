from typing import Optional, TypedDict, List
from ..widget_component import WidgetComponent


class WidgetWrapperProps(TypedDict, total=False):
    noPadding: Optional[bool]
    paddingTop: Optional[bool]
    paddingBottom: Optional[bool]
    paddingLeft: Optional[bool]
    paddingRight: Optional[bool]
    children: List[WidgetComponent]


class WidgetWrapper(WidgetComponent[WidgetWrapperProps]):
    def __init__(self, props: WidgetWrapperProps):
        super().__init__(props)
