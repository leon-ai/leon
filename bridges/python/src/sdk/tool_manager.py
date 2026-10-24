from typing import Optional, Type

from .base_tool import BaseTool
from .leon import leon
from .utils import format_file_path


class MissingToolSettingsError(Exception):
    def __init__(self, missing: list[str], settings_path: str):
        super().__init__(f"Missing tool settings: {', '.join(missing)}")
        self.missing = missing
        self.settings_path = settings_path


class ToolManager:
    @staticmethod
    def get_tool_binary_path(toolkit_id: str, tool_id: str) -> str:
        """Prepare a declared executable without loading its tool's runtime."""

        class BinaryTool(BaseTool):
            @property
            def toolkit(self) -> str:
                return toolkit_id

            @property
            def tool_name(self) -> str:
                return tool_id

            @property
            def description(self) -> str:
                return tool_id

        return BinaryTool().get_binary_path(tool_id)

    @staticmethod
    def init_tool(tool_class: Type[BaseTool]) -> BaseTool:
        tool = tool_class()
        missing = tool.get_missing_settings()

        if missing:
            leon.answer(
                {
                    "key": "bridges.tools.missing_settings",
                    "data": {
                        "tool_name": tool.alias_tool_name,
                        "missing": ", ".join(missing.get("missing", [])),
                        "settings_path": format_file_path(
                            missing.get("settings_path", "")
                        ),
                    },
                    "core": {
                        "should_stop_skill": True,
                    },
                }
            )
            raise MissingToolSettingsError(
                missing.get("missing", []),
                missing.get("settings_path", ""),
            )

        return tool


def is_missing_tool_settings_error(error: Exception) -> bool:
    return isinstance(error, MissingToolSettingsError)
