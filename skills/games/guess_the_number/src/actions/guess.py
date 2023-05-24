from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from ..lib import memory


def run(params: ActionParams) -> None:
    """Check whether the given number matches the chosen number"""

    entities = params['entities']
    given_number = -1
    number_to_guess = memory.get_new_game()['number']

    # Find entities
    for item in entities:
        if item['entity'] == 'number':
            given_number = item['resolution']['value']

    # Return no speech if no number has been found
    if given_number == -1:
        leon.answer({'core': {'isInActionLoop': False}})
        return

    counter = memory.get_new_game()['counter'] + 1
    memory.set_counter(counter)

    if given_number == number_to_guess:
        leon.answer({
            'key': 'guessed',
            'data': {
                'number': number_to_guess,
                'counter': counter
            },
            'core': {
                'isInActionLoop': False,
                'showNextActionSuggestions': True
            }
        })
    elif number_to_guess < given_number:
        leon.answer({'key': 'smaller'})
    elif number_to_guess > given_number:
        leon.answer({'key': 'bigger'})
