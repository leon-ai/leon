from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import akinator, memory


def run(params: ActionParams) -> None:
    """Guess according to the given thematic"""

    resolvers = params['resolvers']
    answer = None

    for resolver in resolvers:
        if resolver['name'] == 'answer':
            answer = resolver['value']

    # Return no speech if no value has been found
    if answer is None:
        return leon.answer({'core': {'isInActionLoop': False}})

    aki = akinator.Akinator()

    session = memory.get_session()
    response = session['response']
    aki.session = session['session']
    aki.signature = session['signature']
    aki.progression = session['progression']
    aki.uri = session['uri']
    aki.timestamp = session['timestamp']
    aki.server = session['server']
    aki.child_mode = session['child_mode']
    aki.frontaddr = session['frontaddr']
    aki.question_filter = session['question_filter']

    resp = aki._parse_response(response)
    aki._update(resp, '"step": "0"' in response)

    if session['progression'] > 80:
        aki.win()

        leon.answer({
            'key': 'guessed',
            'data': {
                'name': aki.first_guess['name'],
                'description': aki.first_guess['description']
            }
        })

        leon.answer({
            'key': 'guessed_img',
            'data': {
                'name': aki.first_guess['name'],
                'url': aki.first_guess['absolute_picture_path']
            }
        })

        return leon.answer({
            'key': 'ask_for_retry',
            'core': {
                'isInActionLoop': False,
                'showNextActionSuggestions': True
            }
        })

    aki.answer(answer)

    memory.upsert_session({
        'response': aki.response,
        'session': aki.session,
        'signature': aki.signature,
        'progression': aki.progression,
        'uri': aki.uri,
        'timestamp': aki.timestamp,
        'server': aki.server,
        'child_mode': aki.child_mode,
        'frontaddr': aki.frontaddr,
        'question_filter': aki.question_filter
    })

    leon.answer({
        'key': aki.question,
        'core': {
            'showSuggestions': True
        }
    })
