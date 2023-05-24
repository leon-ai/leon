import utils
from ..lib import db

owner = db.get_owner()


def introduce_leon(params):
    """Leon introduces himself and
    ask about you if he does not know you yet"""

    is_owner_saved = owner is not None

    if not is_owner_saved:
        return utils.output('end', 'leon_introduction_with_question')

    return utils.output('end', 'leon_introduction')
