from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from random import randint

from bridges.python.src.sdk.widget import WidgetOptions
from ..widgets.number_widget import NumberWidget, NumberWidgetParams


def run(params: ActionParams) -> None:
    """Leon gives a random number"""

    random_number = randint(0, 100)

    number_widget_options: WidgetOptions[NumberWidgetParams] = WidgetOptions(
        params={'random_number': random_number}
    )
    number_widget = NumberWidget(number_widget_options)

    leon.answer({
        'widget': number_widget,
        'key': 'give_number',
        'data': {
            'given_number': random_number
        }
    })
