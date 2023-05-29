from bridges.python.src.sdk.memory import Memory
from typing import TypedDict, Literal


class Session(TypedDict):
    current_question: int
    E: int
    I: int
    S: int
    N: int
    T: int
    F: int
    J: int
    P: int


Letter = Literal['E', 'I', 'S', 'N', 'T', 'F', 'J', 'P']

default_memory: Session = {
    'current_question': 1,
    'E': 0,
    'I': 0,
    'S': 0,
    'N': 0,
    'T': 0,
    'F': 0,
    'J': 0,
    'P': 0
}

session_memory = Memory({
    'name': 'session',
    'default_memory': default_memory
})


def upsert_session(current_question: int) -> None:
    """Save current question number"""

    session = session_memory.read()
    session['current_question'] = current_question
    if current_question == 1:
        session = default_memory
    session_memory.write(session)


def increment_letter_score(letter: Letter) -> None:
    """Add one point to a letter"""

    session = session_memory.read()
    session[letter] += 1
    session_memory.write(session)


def get_session() -> Session:
    """Get current session"""

    return session_memory.read()
