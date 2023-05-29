from bridges.python.src.sdk.memory import Memory
from typing import TypedDict, Any


class Session(TypedDict):
    response: str
    session: int
    progression: float
    signature: int
    uri: str
    timestamp: float
    server: Any
    child_mode: bool
    frontaddr: str
    question_filter: str


session_memory = Memory({
    'name': 'session',
    'default_memory': None
})


def upsert_session(session: Session) -> None:
    """Save progress/info about the session"""

    session_memory.write(session)


def get_session() -> Session:
    """Get current session progress data"""

    return session_memory.read()
