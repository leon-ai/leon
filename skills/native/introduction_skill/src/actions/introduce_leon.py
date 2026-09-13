from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams


def run(params: ActionParams) -> None:
    """Introduce Leon; owner identity is maintained by the owner profile."""
    return leon.answer({'key': 'leon_introduction'})
