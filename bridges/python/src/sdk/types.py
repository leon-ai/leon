from typing import Dict, Any, Optional, Union, Literal, TypedDict


class NLUResultSentiment(TypedDict):
    vote: Optional[Union[Literal['positive'], Literal['neutral'], Literal['negative']]]
    score: Optional[float]


class ExtraContextData(TypedDict):
    lang: str
    sentiment: str
    date: str
    time: str
    timestamp: int
    date_time: str
    week_day: str


class ActionParams(TypedDict):
    lang: str
    utterance: str
    current_entities: list[Any]
    entities: list[Any]
    current_resolvers: list[Any]
    resolvers: list[Any]
    slots: Dict[str, Any]
    extra_context_data: ExtraContextData


AnswerData = Optional[Union[Dict[str, Union[str, int]], None]]


class Answer(TypedDict):
    key: Optional[str]
    widget: Optional[Any]
    data: Optional[AnswerData]
    core: Optional[Dict[str, Any]]


class AnswerInput(TypedDict, total=False):
    key: Optional[str]
    widget: Any
    data: Optional[AnswerData]
    core: Dict[str, Any]


class AnswerConfig(TypedDict):
    text: str
    speech: str
