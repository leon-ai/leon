from ..widget import Widget


# TODO: contains the button API. rendering engine <-> SDK

class ButtonProps:
    def __init__(
        self,
        children=None,
        type=None,
        iconName=None,
        iconPosition=None,
        secondary=False,
        danger=False,
        light=False,
        disabled=False,
        loading=False,
        onClick=None
    ):
        self.children = children
        self.type = type
        self.iconName = iconName
        self.iconPosition = iconPosition
        self.secondary = secondary
        self.danger = danger
        self.light = light
        self.disabled = disabled
        self.loading = loading
        self.onClick = onClick


class Button(Widget):
    def __init__(self, props: ButtonProps):
        super().__init__(props)
