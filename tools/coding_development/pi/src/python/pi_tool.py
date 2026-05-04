import os
import shlex
from typing import Any, Dict, List, Optional

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig

DEFAULT_SETTINGS: Dict[str, Any] = {}
REQUIRED_SETTINGS: List[str] = []
DEFAULT_TIMEOUT_SECONDS = 1_800
DEFAULT_THINKING = "medium"
SHELL_ENV_PREFIX = "PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0"


class PiTool(BaseTool):
    TOOLKIT = "coding_development"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

    @property
    def tool_name(self) -> str:
        return "pi"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def run_coding_task(
        self,
        prompt: str,
        cwd: Optional[str] = None,
        provider: Optional[str] = None,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        thinking: str = DEFAULT_THINKING,
        tools: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT_SECONDS,
    ) -> Dict[str, Any]:
        """
        Run a non-interactive Pi coding-agent task.
        """
        pi_path = self.get_binary_path("pi")
        resolved_cwd = os.path.abspath(cwd or os.getcwd())
        args = ["-p", "--no-session", "--thinking", thinking]

        if provider:
            args.extend(["--provider", provider])

        if model:
            args.extend(["--model", model])

        if api_key:
            args.extend(["--api-key", api_key])

        if tools:
            args.extend(["--tools", tools])

        args.append(prompt)

        command = " ".join(
            [SHELL_ENV_PREFIX, shlex.quote(pi_path)]
            + [shlex.quote(arg) for arg in args]
        )

        output = self.execute_command(
            ExecuteCommandOptions(
                binary_name="bash",
                args=["-c", command],
                options={
                    "sync": True,
                    "cwd": resolved_cwd,
                    "timeout": timeout,
                },
                skip_binary_download=True,
            )
        )

        return {
            "success": True,
            "output": output.strip(),
            "cwd": resolved_cwd,
        }
