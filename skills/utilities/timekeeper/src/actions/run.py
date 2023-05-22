# TODO: find better way to import SDK modules
from bridges.python.src.sdk.leon import leon


def run(params):
    """TODO"""

    leon.answer({'key': 'default'})
    leon.answer({'key': 'data_test', 'data': {'name': 'Louis'}})
