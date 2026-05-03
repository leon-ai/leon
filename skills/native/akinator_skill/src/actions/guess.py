from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

from ..lib import Akinator, AkinatorError, memory


ANSWER_MAPPING = {
    'yes': 'y',
    'no': 'n',
    'dont_know': 'idk',
    'probably': 'p',
    'probably_not': 'pn'
}


def run(params: ActionParams) -> None:
    """Continue the current Akinator round with the owner's latest answer."""

    answer = params.get('action_arguments', {}).get('answer')

    if not isinstance(answer, str):
        leon.answer({'core': {'is_in_action_loop': False}})
        return

    mapped_answer = ANSWER_MAPPING.get(answer)
    if mapped_answer is None:
        leon.answer({'core': {'is_in_action_loop': False}})
        return

    session = memory.get_session()
    akinator = Akinator(
        lang=session['lang'],
        theme=session['theme']
    )
    akinator.json = {
        'step': session['step'],
        'progression': session['progression'],
        'sid': session['sid'],
        'cm': session['cm'],
        'session': session['session'],
        'signature': session['signature']
    }

    try:
        new_progress_response = akinator.post_answer(mapped_answer)
    except AkinatorError:
        leon.answer({
            'key': 'network_error',
            'core': {
                'is_in_action_loop': False,
                'should_stop_skill': True
            }
        })
        return

    if 'name_proposition' in new_progress_response:
        leon.answer({
            'key': 'guessed',
            'data': {
                'name': new_progress_response['name_proposition'],
                'description': new_progress_response['description_proposition']
            }
        })
        leon.answer({
            'key': 'guessed_img',
            'data': {
                'name': new_progress_response['name_proposition'],
                'url': new_progress_response['photo']
            }
        })
        leon.answer({
            'key': 'ask_for_retry',
            'core': {
                'is_in_action_loop': False,
                'next_action': 'akinator_skill:retry'
            }
        })
        return

    memory.upsert_session({
        'lang': session['lang'],
        'theme': session['theme'],
        'sid': session['sid'],
        'cm': session['cm'],
        'signature': session['signature'],
        'session': session['session'],
        'question': new_progress_response['question'],
        'step': int(new_progress_response['step']),
        'progression': float(new_progress_response['progression'])
    })

    leon.answer({
        'key': akinator.question
    })
