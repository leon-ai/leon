from typing import Dict, Any, Optional, Union, Literal, TypedDict

from .widget import Widget


class NLUResultSentiment(TypedDict):
    vote: Optional[Union[Literal['positive'], Literal['neutral'], Literal['negative']]]
    score: Optional[float]


class Context(TypedDict):
    utterances: list[str]
    action_arguments: list[Dict[str, Any]]
    entities: list[Any]
    sentiments: list[NLUResultSentiment]
    data: Dict[str, Any]


class SkillConfig(TypedDict):
    name: str
    bridge: Union[Literal['python'], Literal['nodejs']]
    version: str
    flow: list[str]


class ExtraContext(TypedDict):
    lang: str
    date: str
    time: str
    timestamp: int
    date_time: str
    week_day: str


class ActionParams(TypedDict):
    lang: str
    utterance: str
    action_arguments: Dict[str, Any]
    entities: list[Any]
    sentiment: NLUResultSentiment
    context_name: str
    skill_name: str
    action_name: str
    context: Context
    skill_config: SkillConfig
    skill_config_path: str
    extra_context: ExtraContext


AnswerData = Optional[Union[Dict[str, Union[str, int]], None]]


class Answer(TypedDict, total=False):
    key: Optional[str]
    widget: Optional[Widget]
    data: Optional[AnswerData]
    core: Optional[Dict[str, Any]]
    replaceMessageId: Optional[str]


class TextAnswer(Answer):
    key: str


class WidgetAnswer(Answer):
    widget: Widget
    key: Optional[str]


class AnswerInput(TypedDict, total=False):
    key: Optional[str]
    widget: Optional[Widget]
    data: Optional[AnswerData]
    core: Optional[Dict[str, Any]]
    replaceMessageId: Optional[str]


class AnswerConfig(TypedDict, total=False):
    text: Optional[str]
    speech: Optional[str]
