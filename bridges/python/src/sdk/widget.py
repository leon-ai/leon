from typing import Any, Optional, Generic, TypeVar
from dataclasses import dataclass
from abc import ABC, abstractmethod

from .widget_component import WidgetComponent
from .aurora.widget_wrapper import WidgetWrapperProps

T = TypeVar('T')


@dataclass
class WidgetOptions(Generic[T]):
    wrapper_props: WidgetWrapperProps
    params: T


class Widget(ABC, Generic[T]):
    def __init__(self, options: WidgetOptions[T]):
        self.wrapper_props = options.wrapper_props
        self.params = options.params

    @abstractmethod
    def render(self) -> WidgetComponent:
        pass
