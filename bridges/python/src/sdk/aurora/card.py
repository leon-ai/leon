from typing import TypedDict
from ..widget_component import WidgetComponent


class CardProps(TypedDict, total=False):
    pass


class Card(WidgetComponent[CardProps]):
    def __init__(self, props: CardProps):
        super().__init__(props)
