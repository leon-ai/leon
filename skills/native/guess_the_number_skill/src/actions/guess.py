from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from ..lib import memory


def run(params: ActionParams) -> None:
    """Check whether the given number matches the chosen number"""

    given_number = params.get('action_arguments', {}).get('number')
    number_to_guess = memory.get_new_game()['number']

    # Return no speech if no number has been found
    if given_number is None:
        leon.answer({'core': {'is_in_action_loop': False}})
        return

    given_number = int(given_number)
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
                'is_in_action_loop': False
            }
        })
    elif number_to_guess < given_number:
        leon.answer({'key': 'smaller'})
    elif number_to_guess > given_number:
        leon.answer({'key': 'bigger'})
