from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from random import randint

from bridges.python.src.sdk.widget import WidgetOptions

from ..widgets.number_widget import NumberWidget, NumberWidgetParams


def run(params: ActionParams) -> None:
    """Leon gives a random number"""

    random_number = randint(0, 100)

    # TODO: handle voice text when widget
    number_widget_options: WidgetOptions[NumberWidgetParams] = WidgetOptions(
        wrapper_props={'noPadding': False},
        params={'random_number': random_number}
    )
    number_widget = NumberWidget(number_widget_options)

    leon.answer({
        'widget': number_widget
    })

    # leon.answer({
    #     'key': 'answer',
    #     'data': {
    #         'answer': randint(0, 100)
    #     }
    # })
