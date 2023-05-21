from typing import Dict, Any, Optional, List, TypedDict

# TODO


class AnswerData(TypedDict):
    pass


class Answer(TypedDict):
    key: Optional[str]
    widget: Optional[Any]
    data: Optional[AnswerData]
    core: Optional[Dict[str, Any]]


class AnswerInput(TypedDict):
    key: Optional[str]
    widget: Any
    data: Optional[AnswerData]
    core: Dict[str, Any]


class AnswerConfig(TypedDict):
    text: str
    speech: str
