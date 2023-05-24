import utils
from ..lib import db


def setup(params):
    """Initialize session"""

    session = db.get_session()

    current_question = 1
    db.upsert_session(current_question)

    return utils.output('end', {
        'key': str(current_question),
        'data': {
            'question': str(current_question)
        }
    })
