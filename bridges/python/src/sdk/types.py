from typing import Dict, Any, Optional, List

# TODO


class AnswerData:
    pass


class Answer:
    key: Optional[str]
    widget: Optional[Any]
    data: Optional[AnswerData]
    core: Optional[Dict[str, Any]]


class AnswerInput:
    key: Optional[str]
    widget: Any
    data: Optional[AnswerData]
    core: Dict[str, Any]


class AnswerConfig:
    text: str
    speech: str
