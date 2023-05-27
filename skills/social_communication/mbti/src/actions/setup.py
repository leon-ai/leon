from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory


def run(params: ActionParams) -> None:
    """Initialize session"""

    current_question = 1
    memory.upsert_session(current_question)

    return leon.answer({
        'key': str(current_question),
        'data': {
            'question': str(current_question)
        }
    })
