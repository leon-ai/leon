import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig

DEFAULT_SETTINGS: Dict[str, Any] = {}
REQUIRED_SETTINGS: List[str] = []

DEFAULT_TIMEOUT_SECONDS = 30
TIMEOUT_MILLISECONDS_INPUT_THRESHOLD = 10_000
DEFAULT_TIMEOUT_RETRIES = 2
MAX_TIMEOUT_RETRIES = 5
TIMEOUT_RETRY_MULTIPLIER = 2
MILLISECONDS_PER_SECOND = 1_000

CRITICAL_COMMAND_SEQUENCES: Sequence[Sequence[str]] = (
    ("rm", "-rf", "/"),
    ("rm", "-rf", "/*"),
    ("kill", "-9", "-1"),
)

CRITICAL_COMMAND_TOKENS: Sequence[str] = ("mkfs", "format", "fdisk")
HIGH_RISK_DD_TOKENS: Sequence[str] = ("dd",)
HIGH_RISK_EVAL_DOWNLOAD_TOKENS: Sequence[str] = ("curl", "wget")
ELEVATED_COMMAND_TOKENS: Sequence[str] = ("sudo", "doas", "pkexec", "su")
PERMISSION_COMMAND_TOKENS: Sequence[str] = ("chmod", "chown")
PACKAGE_MANAGER_COMMAND_TOKENS: Sequence[str] = (
    "apt",
    "apt-get",
    "yum",
    "brew",
    "pip",
    "pip3",
)

MEDIUM_RISK_COMMAND_PATTERNS: Sequence[str] = ()

UNSAFE_COMMAND_PATTERNS: Sequence[str] = (
    "fork()",
    "while true; do",
)

TERMINAL_AUTH_COMMANDS = set(ELEVATED_COMMAND_TOKENS)
TERMINAL_AUTH_WRAPPERS = {"env", "command", "builtin", "nohup", "time"}


class BashTool(BaseTool):
    TOOLKIT = "operating_system_control"

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
        return "bash"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def execute_bash_command(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: Optional[int] = 30,
        timeout_unit: Optional[str] = None,
        timeout_retries: Optional[int] = None,
        capture_output: bool = True,
    ) -> Dict[str, Any]:
        analyzed_command = self._resolve_command_for_safety_analysis(command)
        is_safe = self.is_safe_command(analyzed_command)

        if not is_safe:
            risk_level = self.get_command_risk_level(analyzed_command)
            risk_description = self.get_risk_description(analyzed_command)
            return {
                "success": False,
                "stdout": "",
                "stderr": f"Blocked unsafe bash command ({risk_level} risk): This command may {risk_description}.",
                "returncode": -1,
                "command": command,
            }

        requires_visible_terminal = self._requires_visible_terminal(analyzed_command)
        timeout_seconds = self._normalize_timeout_seconds(timeout, timeout_unit)
        timeout_retry_count = self._normalize_timeout_retries(timeout_retries)
        effective_timeout_retries = 0 if requires_visible_terminal else timeout_retry_count

        for attempt in range(effective_timeout_retries + 1):
            try:
                if requires_visible_terminal:
                    self.report("bridges.tools.command_requires_terminal_auth")

                    self.execute_command(
                        ExecuteCommandOptions(
                            binary_name="bash",
                            args=["-c", command],
                            options={
                                "open_in_terminal": True,
                                "wait_for_exit": True,
                                "cwd": cwd or os.getcwd(),
                                "timeout": int(timeout_seconds * MILLISECONDS_PER_SECOND),
                            },
                            skip_binary_download=True,
                        )
                    )

                    return {
                        "success": True,
                        "stdout": "Command executed in a visible terminal. Review that terminal for command output.",
                        "stderr": "",
                        "returncode": 0,
                        "command": command,
                    }

                result_output = self.execute_command(
                    ExecuteCommandOptions(
                        binary_name="bash",
                        args=["-c", command],
                        options={
                            "sync": True,
                            "cwd": cwd or os.getcwd(),
                            "timeout": timeout_seconds,
                        },
                        skip_binary_download=True,
                    )
                )

                return {
                    "success": True,
                    "stdout": result_output.strip(),
                    "stderr": "",
                    "returncode": 0,
                    "command": command,
                }
            except Exception as error:
                error_message = str(error)
                timed_out = self._is_timeout_error_message(error_message)

                if timed_out and attempt < effective_timeout_retries:
                    timeout_seconds *= TIMEOUT_RETRY_MULTIPLIER
                    continue

                if timed_out:
                    return {
                        "success": False,
                        "stdout": "",
                        "stderr": (
                            f"Command timed out after "
                            f"{self._format_timeout_seconds(timeout_seconds)} "
                            f"({attempt + 1} "
                            f"attempt{'' if attempt == 0 else 's'})"
                        ),
                        "returncode": -1,
                        "command": command,
                    }

                if "failed with exit code" in error_message:
                    exit_code_match = re.search(r"exit code (\d+)", error_message)
                    exit_code = (
                        int(exit_code_match.group(1)) if exit_code_match else -1
                    )
                    stderr_match = re.search(r"exit code \d+: (.+)$", error_message)
                    stderr = stderr_match.group(1) if stderr_match else error_message

                    return {
                        "success": False,
                        "stdout": "",
                        "stderr": (
                            f"Command failed in the visible terminal with exit code {exit_code}. Review that terminal for details."
                            if requires_visible_terminal
                            else stderr
                        ),
                        "returncode": exit_code,
                        "command": command,
                    }

                return {
                    "success": False,
                    "stdout": "",
                    "stderr": error_message,
                    "returncode": -1,
                    "command": command,
                }

        return {
            "success": False,
            "stdout": "",
            "stderr": "Command failed without an execution result.",
            "returncode": -1,
            "command": command,
        }

    @staticmethod
    def _normalize_timeout_seconds(
        timeout: Optional[int], timeout_unit: Optional[str] = None
    ) -> float:
        if timeout is None or timeout <= 0:
            return float(DEFAULT_TIMEOUT_SECONDS)

        if timeout_unit == "milliseconds":
            return timeout / MILLISECONDS_PER_SECOND

        if timeout_unit == "seconds":
            return float(timeout)

        if timeout >= TIMEOUT_MILLISECONDS_INPUT_THRESHOLD:
            return timeout / MILLISECONDS_PER_SECOND

        return float(timeout)

    @staticmethod
    def _normalize_timeout_retries(timeout_retries: Optional[int]) -> int:
        if timeout_retries is None:
            return DEFAULT_TIMEOUT_RETRIES

        return min(max(int(timeout_retries), 0), MAX_TIMEOUT_RETRIES)

    @staticmethod
    def _format_timeout_seconds(timeout_seconds: float) -> str:
        if timeout_seconds.is_integer():
            return f"{int(timeout_seconds)} seconds"

        return f"{timeout_seconds:.3f} seconds"

    @staticmethod
    def _is_timeout_error_message(error_message: str) -> bool:
        normalized_error_message = error_message.lower()

        return (
            "timed out" in normalized_error_message
            or "timeout" in normalized_error_message
            or "etimedout" in normalized_error_message
        )

    def is_safe_command(self, command: str) -> bool:
        command_lower = command.lower()
        tokens = self._tokenize_command(command_lower)

        for pattern in UNSAFE_COMMAND_PATTERNS:
            if pattern in command_lower:
                return False

        if (
            self._has_any_token_sequence(tokens, CRITICAL_COMMAND_SEQUENCES)
            or self._has_command_token(tokens, CRITICAL_COMMAND_TOKENS)
            or self._has_dangerous_dd_pattern(tokens)
            or self._has_eval_download_pattern(tokens)
        ):
            return False

        if self._is_download_piped_to_shell(command_lower):
            return False

        return True

    def get_command_risk_level(self, command: str) -> str:
        command_lower = command.lower()
        tokens = self._tokenize_command(command_lower)

        risk_level = "low"

        if self._has_any_token_sequence(
            tokens, CRITICAL_COMMAND_SEQUENCES
        ) or self._has_command_token(tokens, CRITICAL_COMMAND_TOKENS):
            risk_level = "critical"

        if risk_level == "low":
            if self._has_dangerous_dd_pattern(
                tokens
            ) or self._has_eval_download_pattern(tokens):
                risk_level = "high"

        if risk_level == "low" and self._is_download_piped_to_shell(command_lower):
            risk_level = "high"

        if risk_level == "low":
            for pattern in MEDIUM_RISK_COMMAND_PATTERNS:
                if pattern in command_lower:
                    risk_level = "medium"
                    break

        return risk_level

    def get_risk_description(self, command: str) -> str:
        risk_level = self.get_command_risk_level(command)
        command_lower = command.lower()
        tokens = self._tokenize_command(command_lower)

        if self._has_command_token(tokens, ("rm",)):
            return "delete files or directories permanently"
        if self._has_command_token(tokens, ELEVATED_COMMAND_TOKENS):
            return "make system-level changes with elevated privileges"
        if self._has_command_token(tokens, ("kill",)):
            return "terminate running processes"
        if self._has_command_token(tokens, PERMISSION_COMMAND_TOKENS):
            return "change file permissions or ownership"
        if self._has_command_token(tokens, PACKAGE_MANAGER_COMMAND_TOKENS):
            return "install or modify system packages"
        if self._is_download_piped_to_shell(command_lower):
            return "download remote content and execute it as a shell script"
        if self._has_command_token(tokens, HIGH_RISK_EVAL_DOWNLOAD_TOKENS):
            return "download content from the internet"

        descriptions = {
            "critical": "cause severe system damage",
            "high": "cause significant system changes",
            "medium": "modify your system",
            "low": "perform system operations",
        }
        return descriptions.get(risk_level, "affect your system")

    def _resolve_command_for_safety_analysis(self, command: str) -> str:
        trimmed_command = command.strip()
        if not trimmed_command or any(char.isspace() for char in trimmed_command):
            return command

        resolved_path = Path(trimmed_command).expanduser().resolve()

        try:
            if not resolved_path.is_file():
                return command

            file_content = resolved_path.read_text(encoding="utf-8")
            if not file_content.strip():
                return command

            return file_content
        except Exception:
            return command

    def _is_download_piped_to_shell(self, command_lower: str) -> bool:
        downloads_remote_content = self._has_command_token(
            self._tokenize_command(command_lower), ("curl", "wget")
        )
        pipes_to_shell = "| bash" in command_lower or "| sh" in command_lower
        return downloads_remote_content and pipes_to_shell

    def _tokenize_command(self, command: str) -> List[str]:
        tokens: List[str] = []
        current_token = ""
        quote: Optional[str] = None
        escaped = False

        def flush_token() -> None:
            nonlocal current_token
            if not current_token:
                return
            tokens.append(current_token)
            current_token = ""

        for char in command:
            if quote:
                if escaped:
                    current_token += char
                    escaped = False
                    continue

                if char == "\\" and quote == '"':
                    escaped = True
                    continue

                if char == quote:
                    quote = None
                    continue

                current_token += char
                continue

            if char in ("'", '"'):
                quote = char
                continue

            if char in ("\n", ";", "|", "&", " ", "\t", "\r", ">", "<"):
                flush_token()
                continue

            current_token += char

        flush_token()
        return tokens

    def _has_token_sequence(
        self, tokens: Sequence[str], sequence: Sequence[str]
    ) -> bool:
        if len(sequence) == 0 or len(tokens) < len(sequence):
            return False

        for index in range(len(tokens) - len(sequence) + 1):
            matches = all(
                tokens[index + offset] == token
                for offset, token in enumerate(sequence)
            )
            if matches:
                return True

        return False

    def _has_command_token(
        self, tokens: Sequence[str], commands: Sequence[str]
    ) -> bool:
        for token in tokens:
            normalized_token = self._normalize_command_token(token)
            for command in commands:
                if normalized_token == command or normalized_token.startswith(
                    f"{command}."
                ):
                    return True
        return False

    def _has_dangerous_dd_pattern(self, tokens: Sequence[str]) -> bool:
        if not self._has_command_token(tokens, HIGH_RISK_DD_TOKENS):
            return False

        return any(token.startswith("if=") for token in tokens)

    def _has_eval_download_pattern(self, tokens: Sequence[str]) -> bool:
        for index in range(len(tokens) - 1):
            if tokens[index] != "eval":
                continue

            next_token = tokens[index + 1]
            if any(
                next_token.startswith(f"$({token}")
                for token in HIGH_RISK_EVAL_DOWNLOAD_TOKENS
            ):
                return True

        return False

    def _normalize_command_token(self, token: str) -> str:
        stripped_token = re.sub(r"^[([{]+|[)\]}]+$", "", token)
        if "/" in stripped_token:
            return stripped_token.split("/")[-1] or stripped_token
        return stripped_token

    def _has_any_token_sequence(
        self, tokens: Sequence[str], sequences: Sequence[Sequence[str]]
    ) -> bool:
        return any(self._has_token_sequence(tokens, sequence) for sequence in sequences)

    def _requires_visible_terminal(self, command: str) -> bool:
        current_token = ""
        quote: Optional[str] = None
        at_command_start = True
        escaped = False

        def flush_token() -> bool:
            nonlocal current_token, at_command_start
            if not current_token:
                return False

            token = current_token
            current_token = ""

            if not at_command_start:
                return False

            if self._is_shell_assignment(token) or token in TERMINAL_AUTH_WRAPPERS:
                return False

            at_command_start = False
            return token in TERMINAL_AUTH_COMMANDS

        for char in command:
            if quote:
                if escaped:
                    escaped = False
                    continue

                if char == "\\" and quote == '"':
                    escaped = True
                    continue

                if char == quote:
                    quote = None
                continue

            if char in ("'", '"'):
                quote = char
                continue

            if char in ("\n", ";", "|", "&"):
                if flush_token():
                    return True
                at_command_start = True
                continue

            if char in (" ", "\t", "\r"):
                if flush_token():
                    return True
                continue

            current_token += char

        return flush_token()

    def _is_shell_assignment(self, token: str) -> bool:
        separator_index = token.find("=")
        if separator_index <= 0:
            return False

        return "/" not in token[:separator_index]
