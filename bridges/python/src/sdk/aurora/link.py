from ..widget_component import WidgetComponent


class Link(WidgetComponent[dict]):
    def __init__(self, props: dict):
        super().__init__(props)
