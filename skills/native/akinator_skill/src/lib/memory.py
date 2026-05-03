from typing import TypedDict

from bridges.python.src.sdk.memory import Memory


class Session(TypedDict):
    question: str
    progression: float
    step: int
    session: str
    signature: str
    lang: str
    theme: str
    sid: int
    cm: bool


session_memory = Memory({
    'name': 'session',
    'default_memory': {}
})


def upsert_session(session: Session) -> None:
    """Save progress and session info about the current Akinator round."""

    session_memory.write(session)


def get_session() -> Session:
    """Get current Akinator session progress data."""

    return session_memory.read()
