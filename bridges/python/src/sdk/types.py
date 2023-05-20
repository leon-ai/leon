from typing import Dict, Any, Optional, List

# TODO

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

class AnswerData:
  pass

class AnswerConfig:
  text: str
  speech: str
