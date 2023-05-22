# TODO: find better way to import SDK modules
from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.aurora.button import Button


def run(params):
    """TODO"""

    # TODO
    # network request
    # memory
    # install bs4 and grab it from skill

    ###

    button = Button({'text': 'Hello world from action skill'})

    leon.answer({'widget': button})

    ###

    leon.answer({'key': 'test'})

    ###

    options = leon.get_src_config('options')
    leon.answer({
        'key': 'answer',
        'data': {
            'answer': options['test_config']
        }
    })

    ###

    leon.answer({'key': 'just a raw answer...'})
    leon.answer({'key': 'default'})
    leon.answer({'key': 'data_test', 'data': {'name': 'Louis'}})
