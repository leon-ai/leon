from ..widget_component import WidgetComponent


class TabGroup(WidgetComponent[dict]):
    def __init__(self, props: dict):
        super().__init__(props)
