from typing import TypeVar

T = TypeVar('T')


class WidgetComponent:
    def __init__(self, props: T):
        self.component = type(self).__name__
        self.props = props

    def __repr__(self):
        return f"{self.component}({repr(self.props)})"
