from typing import Any, Optional, Generic, TypeVar, Literal, TypedDict, Union, Dict
from dataclasses import dataclass
from abc import ABC, abstractmethod
import random
import string

from .widget_component import WidgetComponent
from ..constants import SKILL_LOCALE_CONFIG, INTENT_OBJECT

T = TypeVar('T')

UtteranceSender = Literal['leon', 'owner']


class SendUtteranceWidgetEventMethodParams(TypedDict):
    from_: UtteranceSender
    utterance: str


class RunSkillActionWidgetEventMethodParams(TypedDict):
    action_name: str
    params: Dict[str, Any]


class SendUtteranceOptions(TypedDict, total=False):
    from_: Optional[UtteranceSender]
    data: Optional[Dict[str, Any]]


class WidgetEventMethod(TypedDict):
    methodName: Literal['send_utterance', 'run_skill_action']
    methodParams: Union[
        SendUtteranceWidgetEventMethodParams,
        RunSkillActionWidgetEventMethodParams
    ]


@dataclass
class WidgetOptions(Generic[T]):
    wrapper_props: dict[str, Any] = None
    params: T = None
    on_fetch: Optional[dict[str, Any]] = None


class Widget(ABC, Generic[T]):
    def __init__(self, options: WidgetOptions[T]):
        if options.wrapper_props:
            self.wrapper_props = options.wrapper_props
        else:
            self.wrapper_props = None
        self.action_name = f"{INTENT_OBJECT['skill_name']}:{INTENT_OBJECT['action_name']}"
        self.params = options.params
        self.widget = self.__class__.__name__
        if options.on_fetch:
            self.on_fetch = {
                'widgetId': options.on_fetch.get('widget_id'),
                'actionName': f"{INTENT_OBJECT['skill_name']}:{options.on_fetch.get('action_name')}"
            }
        else:
            self.on_fetch = None
        self.id = options.on_fetch.get('widget_id') if options.on_fetch \
            else f"{self.widget.lower()}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}"

    @abstractmethod
    def render(self) -> WidgetComponent:
        pass

    def send_utterance(self, key: str, options: Optional[Dict[str, Any]] = None) -> WidgetEventMethod:
        """
        Indicate the core to send a given utterance
        :param key: The key of the content
        :param options: The options of the utterance
        """
        utterance_content = self.content(key, options.get('data') if options else None)
        from_ = options.get('from', 'owner') if options else 'owner'

        return WidgetEventMethod(
            methodName='send_utterance',
            methodParams={
                'from': from_,
                'utterance': utterance_content
            }
        )

    def run_skill_action(self, action_name: str, params: Dict[str, Any]) -> WidgetEventMethod:
        """
        Indicate the core to run a given skill action
        :param action_name: The name of the action
        :param params: The parameters of the action
        """
        return WidgetEventMethod(
            methodName='run_skill_action',
            methodParams={
                'actionName': action_name,
                'params': params
            }
        )

    def content(self, key: str, data: Optional[Dict[str, Any]] = None) -> str:
        """
        Grab and compute the target content of the widget
        :param key: The key of the content
        :param data: The data to apply
        """
        widget_contents = SKILL_LOCALE_CONFIG.get('widget_contents', {})

        if key not in widget_contents:
            return 'INVALID'

        content = widget_contents[key]

        if isinstance(content, list):
            content = random.choice(content)

        if data:
            for k, v in data.items():
                content = content.replace(f"{{{{ {key} }}}}", str(v))

        return content
