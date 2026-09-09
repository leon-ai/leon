from dataclasses import dataclass
from threading import Event
from typing import Any, Callable, Literal, NotRequired, TypedDict


class ToolModelFile(TypedDict):
    """Model evidence using the same serialized fields as the Node.js SDK."""

    dataBase64: str
    mediaType: str
    filename: NotRequired[str]
    visualDetail: NotRequired[Literal["auto", "low", "high"]]


class ToolRuntimeProgress(TypedDict):
    """Progress emitted by a tool during execution."""

    source: Literal["log", "report"]
    message: str
    key: NotRequired[str]
    data: NotRequired[dict[str, Any]]


@dataclass
class ToolExecutionContext:
    """Host-owned identity and call state, separate from model arguments.

    A set signal requests cooperative cancellation. Python tools can check
    signal.is_set() or use signal.wait(timeout) for interruptible waits.
    """

    toolkit_id: str
    tool_id: str
    function_name: str
    parameters: dict[str, Any]
    profile_name: str
    conversation_session_id: str | None
    signal: Event | None = None
    on_progress: Callable[[ToolRuntimeProgress], None] | None = None


class ToolRuntimeResult(TypedDict):
    """Execution result with evidence kept outside ordinary tool observations."""

    success: bool
    message: str
    output: dict[str, Any]
    modelFiles: NotRequired[list[ToolModelFile]]
