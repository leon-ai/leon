from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from random import randint


def run(params: ActionParams) -> None:
    """Leon gives a random number"""
    leon.answer({
        'key': 'answer',
        'data': {
            'answer': randint(0, 100)
        }
    })
