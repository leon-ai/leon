from typing import Any, Optional

from .widget_component import WidgetComponent
from aurora.widget_wrapper import WidgetWrapperProps

class WidgetOptions:
    def __init__(
        self,
        wrapperProps: Optional[WidgetWrapperProps] = None,
        params: Optional[Any] = None
    ):
        self.wrapperProps = wrapperProps
        self.params = params

class Widget:
    wrapperProps: Optional[WidgetOptions['wrapperProps']]
    params: Optional[WidgetOptions['params']]

    def __init__(self, options: Optional[WidgetOptions] = None):
        if options and options.wrapperProps:
            self.wrapperProps = options.wrapperProps

        if not options or not options.params:
            self.params = None
        else:
            self.params = options.params

    def render(self) -> WidgetComponent:
        pass
