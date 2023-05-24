from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory


def run(params: ActionParams) -> None:
    """Leon introduces himself and ask about you if he does not know you yet"""
    owner = memory.get_owner()
    is_owner_saved = owner is not None

    if not is_owner_saved:
        return leon.answer({'key': 'leon_introduction_with_question'})

    return leon.answer({'key': 'leon_introduction'})
