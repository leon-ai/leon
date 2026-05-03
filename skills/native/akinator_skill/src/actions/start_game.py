from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from ..lib import Akinator, AkinatorError, memory


def run(params: ActionParams) -> None:
    """Start a new Akinator round with the chosen thematic."""

    thematic = params.get('action_arguments', {}).get('thematic')

    if not isinstance(thematic, str):
        leon.answer({
            'core': {
                'should_stop_skill': True
            }
        })
        return

    leon.answer({'key': 'calling_akinator'})

    try:
        akinator = Akinator(
            lang=params['lang'],
            theme=thematic
        )
        question = akinator.start_game()

        memory.upsert_session({
            'lang': params['lang'],
            'theme': thematic,
            'cm': False,
            'sid': akinator.json['sid'],
            'question': akinator.question,
            'step': akinator.step,
            'progression': akinator.progression,
            'signature': akinator.json['signature'],
            'session': akinator.json['session']
        })

        leon.answer({
            'key': question,
            'core': {
                'context_data': {
                    'thematic': thematic
                },
                'next_action': 'akinator_skill:guess'
            }
        })
    except AkinatorError:
        leon.answer({
            'key': 'network_error',
            'core': {
                'should_stop_skill': True
            }
        })
