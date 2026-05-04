import os
import re
import shlex
from abc import ABC, abstractmethod
from typing import Callable, Dict, Optional, Union, List, Any
from pypdl import Pypdl
from urllib.parse import urlparse
from .toolkit_config import ToolkitConfig
from .leon import leon
from .utils import (
    is_windows,
    is_macos,
    set_hugging_face_url,
    format_bytes,
    format_speed,
    format_eta,
    format_file_path,
    extract_archive,
)
from ..constants import (
    LEON_TOOLKITS_PATH,
    NVIDIA_LIBS_PATH,
    PROFILE_TOOLS_PATH,
    PYTORCH_TORCH_PATH,
)
import subprocess
import sys
import time
import tempfile
import shutil

# Progress callback type for reporting tool progress
ProgressCallback = Callable[[Dict[str, Optional[Union[str, int, float]]]], None]

NVIDIA_LIBRARY_FOLDERS = [
    "cublas",
    "cudnn",
    "cuda_cudart",
    "cuda_cupti",
    "cusparse",
    "cusparselt",
    "cusparse_full",
    "nccl",
    "nvshmem",
    "nvjitlink",
]


# Command execution options
class ExecuteCommandOptions:
    def __init__(
        self,
        binary_name: str,
        args: List[str],
        options: Optional[Dict[str, Any]] = None,
        on_progress: Optional[ProgressCallback] = None,
        on_output: Optional[Callable[[str, bool], None]] = None,
        skip_binary_download: bool = False,
    ):
        self.binary_name = binary_name
        self.args = args
        self.options = options or {}
        self.on_progress = on_progress
        self.on_output = on_output
        self.skip_binary_download = skip_binary_download


class BaseTool(ABC):
    """Base class for Python tools"""

    def __init__(self):
        """Initialize the tool with default settings"""
        self.cli_progress = True
        self.settings: Dict[str, Any] = {}
        self.required_settings: List[str] = []
        self.missing_settings: Optional[Dict[str, Any]] = None

    @property
    @abstractmethod
    def tool_name(self) -> str:
        """Tool name"""
        pass

    @property
    @abstractmethod
    def toolkit(self) -> str:
        """Toolkit name"""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Tool description"""
        pass

    @property
    def alias_tool_name(self) -> str:
        """Tool alias name (human readable)"""
        try:
            config = ToolkitConfig.load(self.toolkit, self.tool_name)
            return config.get("name") or self.tool_name
        except Exception:
            return self.tool_name

    def _get_settings_path(self, tool_name: Optional[str] = None) -> str:
        resolved_tool_name = tool_name or self.tool_name

        return os.path.join(
            PROFILE_TOOLS_PATH, self.toolkit, resolved_tool_name, "settings.json"
        )

    def _check_required_settings(self, tool_name: Optional[str] = None) -> None:
        if not self.required_settings:
            self.missing_settings = None
            return

        missing: List[str] = []
        for key in self.required_settings:
            value = self.settings.get(key)
            if value is None:
                missing.append(key)
                continue
            if isinstance(value, str) and value.strip() == "":
                missing.append(key)

        self.missing_settings = (
            {
                "missing": missing,
                "settings_path": self._get_settings_path(tool_name),
            }
            if missing
            else None
        )

    def get_missing_settings(self) -> Optional[Dict[str, Any]]:
        return self.missing_settings

    def _escape_shell_arg(self, arg: str) -> str:
        """
        Escape a shell argument.
        """
        if is_windows():
            # Windows: wrap in double quotes and escape internal quotes
            if " " in arg or '"' in arg or "&" in arg or "|" in arg:
                return (
                    f'"{arg.replace(chr(34), chr(92) + chr(34))}"'  # Replace " with \"
                )
            return arg
        else:
            return shlex.quote(arg)

    def _get_tool_dir(self, module_file: str) -> str:
        return os.path.dirname(os.path.abspath(module_file))

    def _format_command_output(self, output: str) -> Optional[str]:
        trimmed = output.strip()
        if not trimmed:
            return None

        max_length = 4000
        if len(trimmed) <= max_length:
            return trimmed

        return f"{trimmed[:max_length]}\n... (truncated)"

    def _report_command_output(
        self, output: str, command: str, tool_group_id: Optional[str]
    ) -> None:
        formatted = self._format_command_output(output)
        if not formatted:
            return

        self.report(
            "bridges.tools.command_output",
            {"command": command, "output": formatted},
            tool_group_id,
        )

    def _get_bundled_library_paths(self) -> List[str]:
        bundled_paths = [os.path.join(PYTORCH_TORCH_PATH, "torch", "lib")]

        for folder_name in NVIDIA_LIBRARY_FOLDERS:
            bundled_paths.append(os.path.join(NVIDIA_LIBS_PATH, folder_name, "lib"))

        return [candidate for candidate in bundled_paths if os.path.isdir(candidate)]

    def _get_command_env(self) -> Dict[str, str]:
        env = os.environ.copy()
        bundled_paths = self._get_bundled_library_paths()

        if not bundled_paths:
            return env

        if is_windows():
            env_var_name = "PATH"
        elif is_macos():
            env_var_name = "DYLD_LIBRARY_PATH"
        else:
            env_var_name = "LD_LIBRARY_PATH"

        existing_value = env.get(env_var_name, "")
        env[env_var_name] = os.pathsep.join(
            [*bundled_paths, existing_value] if existing_value else bundled_paths
        )

        return env

    def execute_command(self, options: ExecuteCommandOptions) -> str:
        """Execute a command with proper Leon messaging and progress tracking"""

        binary_name = options.binary_name
        args = options.args
        exec_options = options.options
        on_progress = options.on_progress
        on_output = options.on_output
        skip_binary_download = options.skip_binary_download

        sync = exec_options.get("sync", True) if exec_options else True

        # Get binary path (auto-downloads if needed)
        binary_path = self.get_binary_path(binary_name, skip_binary_download)
        command_string = (
            f'"{binary_path}" {" ".join([self._escape_shell_arg(arg) for arg in args])}'
        )

        # Generate a unique group ID for this command execution
        tool_group_id = f"{self.toolkit}_{self.tool_name}_{int(time.time() * 1000)}"

        self.report(
            "bridges.tools.executing_command",
            {"binary_name": binary_name, "command": command_string},
            tool_group_id,
        )

        if exec_options and exec_options.get("open_in_terminal"):
            return self._execute_terminal_command(
                binary_path, args, command_string, exec_options, tool_group_id
            )

        if sync:
            return self._execute_sync_command(
                binary_path, args, command_string, exec_options, tool_group_id
            )
        else:
            return self._execute_async_command(
                binary_path,
                args,
                command_string,
                exec_options,
                tool_group_id,
                on_progress,
                on_output,
            )

    def _execute_sync_command(
        self,
        binary_path: str,
        args: List[str],
        command_string: str,
        exec_options: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None,
    ) -> str:
        """Execute command synchronously"""

        try:
            start_time = time.time()

            result = subprocess.run(
                command_string,
                capture_output=True,
                text=True,
                shell=True,
                timeout=exec_options.get("timeout") if exec_options else None,
                cwd=exec_options.get("cwd") if exec_options else None,
                env=self._get_command_env(),
            )

            execution_time = int((time.time() - start_time) * 1000)

            if result.returncode == 0:
                self.report(
                    "bridges.tools.command_completed",
                    {
                        "command": command_string,
                        "execution_time": f"{execution_time}ms",
                    },
                    tool_group_id,
                )
                output = "".join([result.stdout or "", result.stderr or ""])
                self._report_command_output(output, command_string, tool_group_id)
                return result.stdout
            else:
                self.report(
                    "bridges.tools.command_failed",
                    {
                        "command": command_string,
                        "error": result.stderr or "Unknown error",
                        "exit_code": str(result.returncode),
                        "execution_time": f"{execution_time}ms",
                    },
                    tool_group_id,
                )
                output = "".join([result.stdout or "", result.stderr or ""])
                self._report_command_output(output, command_string, tool_group_id)
                raise Exception(
                    f"Command failed with exit code {result.returncode}: {result.stderr}"
                )

        except subprocess.TimeoutExpired as e:
            self.report(
                "bridges.tools.command_timeout",
                {
                    "command": command_string,
                    "timeout": f"{e.timeout}s" if e.timeout else "unknown",
                },
                tool_group_id,
            )
            raise Exception(f"Command timed out after {e.timeout}s")
        except Exception as e:
            self.report(
                "bridges.tools.command_error",
                {"command": command_string, "error": str(e)},
                tool_group_id,
            )
            raise

    def _execute_async_command(
        self,
        binary_path: str,
        args: List[str],
        command_string: str,
        exec_options: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None,
        on_progress: Optional[ProgressCallback] = None,
        on_output: Optional[Callable[[str, bool], None]] = None,
    ) -> str:
        """Execute command asynchronously with progress tracking"""

        try:
            start_time = time.time()
            output_buffer = ""

            process = subprocess.Popen(
                [binary_path] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=exec_options.get("cwd") if exec_options else None,
                env=self._get_command_env(),
            )

            # Read output in real time
            while True:
                stdout_line = process.stdout.readline() if process.stdout else ""
                stderr_line = process.stderr.readline() if process.stderr else ""

                if stdout_line:
                    output_buffer += stdout_line
                    if on_output:
                        on_output(stdout_line, False)
                    if on_progress:
                        on_progress({"status": "running"})

                if stderr_line:
                    output_buffer += stderr_line
                    if on_output:
                        on_output(stderr_line, True)

                if process.poll() is not None:
                    break

            execution_time = int((time.time() - start_time) * 1000)

            if process.returncode == 0:
                self.report(
                    "bridges.tools.command_completed",
                    {
                        "command": command_string,
                        "execution_time": f"{execution_time}ms",
                    },
                    tool_group_id,
                )
                self._report_command_output(
                    output_buffer, command_string, tool_group_id
                )
                if on_progress:
                    on_progress({"status": "completed", "percentage": 100})
                return output_buffer
            else:
                self.report(
                    "bridges.tools.command_failed",
                    {
                        "command": command_string,
                        "exit_code": str(process.returncode),
                        "execution_time": f"{execution_time}ms",
                    },
                    tool_group_id,
                )
                self._report_command_output(
                    output_buffer, command_string, tool_group_id
                )
                raise Exception(
                    f"Command failed with exit code {process.returncode}: {output_buffer}"
                )

        except Exception as e:
            self.report(
                "bridges.tools.command_error",
                {"command": command_string, "error": str(e)},
                tool_group_id,
            )
            raise

    def _execute_terminal_command(
        self,
        binary_path: str,
        args: List[str],
        command_string: str,
        exec_options: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None,
    ) -> str:
        cwd = exec_options.get("cwd") if exec_options else None
        timeout = exec_options.get("timeout") if exec_options else None
        timeout_seconds = int(timeout / 1000) if timeout else 600
        wait_for_exit = (
            exec_options.get("wait_for_exit", True) if exec_options else True
        )
        marker_file = os.path.join(
            tempfile.gettempdir(),
            f"{self.toolkit}_{self.tool_name}_{int(time.time() * 1000)}.done",
        )

        run_command = self._build_terminal_run_command(
            binary_path, args, cwd or os.getcwd(), marker_file
        )
        self._launch_terminal(run_command)

        if not wait_for_exit:
            return ""

        start_time = time.time()
        exit_code = self._wait_for_marker(marker_file, timeout_seconds)
        execution_time = int((time.time() - start_time) * 1000)

        if exit_code is None:
            self.report(
                "bridges.tools.command_timeout",
                {
                    "command": command_string,
                    "timeout": f"{timeout_seconds}s",
                },
                tool_group_id,
            )
            raise Exception(f"Command timed out after {timeout_seconds}s")

        if exit_code != 0:
            self.report(
                "bridges.tools.command_failed",
                {
                    "command": command_string,
                    "exit_code": str(exit_code),
                    "execution_time": f"{execution_time}ms",
                },
                tool_group_id,
            )
            raise Exception(f"Command failed with exit code {exit_code}")

        self.report(
            "bridges.tools.command_completed",
            {
                "command": command_string,
                "execution_time": f"{execution_time}ms",
            },
            tool_group_id,
        )

        return ""

    def _build_terminal_run_command(
        self, binary_path: str, args: List[str], cwd: str, marker_file: str
    ) -> str:
        if is_windows():
            cwd_arg = self._escape_windows_arg(cwd)
            marker_arg = self._escape_windows_arg(marker_file)
            command = self._build_binary_command(binary_path, args)
            return f"cd /d {cwd_arg} && {command} & echo %ERRORLEVEL% > {marker_arg}"

        cwd_arg = self._escape_shell_arg(cwd)
        marker_arg = self._escape_shell_arg(marker_file)
        command = self._build_binary_command(binary_path, args)
        return f"cd {cwd_arg} && {command}; echo $? > {marker_arg}"

    def _build_binary_command(self, binary_path: str, args: List[str]) -> str:
        binary_arg = self._escape_shell_arg(binary_path)
        arg_string = " ".join(self._escape_shell_arg(arg) for arg in args)
        return f"{binary_arg} {arg_string}".strip()

    def _launch_terminal(self, command: str) -> None:
        if is_macos():
            term_program = os.environ.get("TERM_PROGRAM", "")
            escaped = self._escape_applescript(command)
            if "iterm" in term_program.lower():
                script = "\n".join(
                    [
                        'tell application "iTerm"',
                        "  create window with default profile",
                        f'  tell current session of current window to write text "{escaped}"',
                        "end tell",
                    ]
                )
                subprocess.Popen(["osascript", "-e", script])
                return

            script = f'tell application "Terminal" to do script "{escaped}"'
            subprocess.Popen(["osascript", "-e", script])
            return

        if is_windows():
            if os.environ.get("WT_SESSION") or self._command_exists("wt"):
                subprocess.Popen(["wt", "cmd", "/k", command])
                return
            subprocess.Popen(["cmd", "/c", "start", "", "cmd", "/k", command])
            return

        linux_command = f"{command}; echo Command finished.; exec $SHELL"
        linux_candidates = [
            ("gnome-terminal", ["--", "bash", "-lc", linux_command]),
            ("x-terminal-emulator", ["-e", "bash", "-lc", linux_command]),
            ("konsole", ["-e", "bash", "-lc", linux_command]),
            ("xfce4-terminal", ["--command", f'bash -lc "{linux_command}"']),
            ("xterm", ["-e", "bash", "-lc", linux_command]),
            ("kitty", ["bash", "-lc", linux_command]),
        ]

        for command_name, args in linux_candidates:
            if not self._command_exists(command_name):
                continue
            subprocess.Popen([command_name, *args])
            return

        raise Exception("No supported terminal emulator found to launch command.")

    def _wait_for_marker(self, marker_file: str, timeout_seconds: int) -> Optional[int]:
        start_time = time.time()
        while time.time() - start_time < timeout_seconds:
            if os.path.exists(marker_file):
                try:
                    with open(marker_file, "r", encoding="utf-8") as handle:
                        content = handle.read().strip()
                    return int(content) if content else 1
                except Exception:
                    return 1
            time.sleep(0.5)
        return None

    def _escape_applescript(self, value: str) -> str:
        return value.replace("\\", "\\\\").replace('"', '\\"')

    def _escape_windows_arg(self, value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def _command_exists(self, command: str) -> bool:
        return shutil.which(command) is not None

    def get_binary_path(
        self, binary_name: str, skip_binary_download: bool = False
    ) -> str:
        """Get binary path and ensure it's downloaded"""
        from urllib.parse import urlparse

        # For built-in commands like bash, just return the binary name
        if skip_binary_download:
            return binary_name

        # Get tool name without "Tool" suffix for config lookup
        tool_config_name = self.tool_name.lower().replace("tool", "")
        config = ToolkitConfig.load(self.toolkit, tool_config_name)
        binary_url = ToolkitConfig.get_binary_url(config)

        self.report("bridges.tools.checking_binary", {"binary_name": binary_name})
        if not binary_url:
            self.report("bridges.tools.no_binary_url", {"binary_name": binary_name})
            raise Exception(f"No download URL found for binary '{binary_name}'")

        # Extract the actual filename from the URL
        parsed_url = urlparse(binary_url)
        actual_filename = os.path.basename(parsed_url.path)

        # Strip archive extensions to get the base binary name
        archive_extensions = [".tar.gz", ".tar.xz", ".tgz", ".zip", ".tar"]
        for ext in archive_extensions:
            if actual_filename.lower().endswith(ext):
                actual_filename = actual_filename[: -len(ext)]
                break

        executable = (
            f"{actual_filename}.exe"
            if is_windows() and not actual_filename.endswith(".exe")
            else actual_filename
        )

        bins_path = os.path.join(LEON_TOOLKITS_PATH, self.toolkit, "assets")

        # Ensure toolkit bins directory exists
        if not os.path.exists(bins_path):
            self.report(
                "bridges.tools.creating_bins_directory", {"toolkit": self.toolkit}
            )
            os.makedirs(bins_path, exist_ok=True)

        binary_path = os.path.join(bins_path, executable)

        # Ensure binary is available before returning path
        if not os.path.exists(binary_path):
            self._download_binary_on_demand(binary_name, binary_url, executable)

        # Force chmod again in case it has been downloaded but somehow failed
        # so it could not chmod correctly earlier
        if not is_windows():
            self.report(
                "bridges.tools.applying_permissions", {"binary_name": binary_name}
            )
            os.chmod(binary_path, 0o755)

        self.report("bridges.tools.binary_ready", {"binary_name": binary_name})

        return binary_path

    def get_resource_path(self, resource_name: str) -> str:
        """
        Get resource path and ensure all resource files are downloaded

        Args:
        resource_name: The name of the resource as defined in the tool manifest

        Returns:
            The path to the resource directory
        """
        from urllib.parse import urlparse

        # Get tool name without "Tool" suffix for config lookup
        tool_config_name = self.tool_name.lower().replace("tool", "")
        config = ToolkitConfig.load(self.toolkit, tool_config_name)
        resource_urls = config.get("resources", {}).get(resource_name)

        self.report("bridges.tools.checking_resource", {"resource_name": resource_name})

        if (
            not resource_urls
            or not isinstance(resource_urls, list)
            or len(resource_urls) == 0
        ):
            self.report(
                "bridges.tools.no_resource_urls", {"resource_name": resource_name}
            )
            raise Exception(f"No download URLs found for resource '{resource_name}'")

        resource_path = os.path.join(
            LEON_TOOLKITS_PATH,
            self.toolkit,
            "assets",
            resource_name
        )

        # Ensure resource directory exists
        if not os.path.exists(resource_path):
            self.report(
                "bridges.tools.creating_resource_directory",
                {
                    "resource_name": resource_name,
                    "resource_path": format_file_path(resource_path),
                },
            )
            os.makedirs(resource_path, exist_ok=True)

        # Check if all resource files exist and are complete
        if self._is_resource_complete(resource_path, resource_urls):
            self.report(
                "bridges.tools.resource_already_exists",
                {
                    "resource_name": resource_name,
                    "resource_path": format_file_path(resource_path),
                },
            )
            return resource_path

        self.report(
            "bridges.tools.downloading_resource", {"resource_name": resource_name}
        )

        # Download each resource file
        for resource_url in resource_urls:
            adjusted_url = set_hugging_face_url(resource_url)

            relative_path = self._get_resource_relative_path(adjusted_url)

            if not relative_path:
                raise Exception(f"Invalid filename extracted from URL: {adjusted_url}")

            file_name = os.path.basename(relative_path)
            file_path = os.path.join(resource_path, relative_path)

            self.report(
                "bridges.tools.downloading_resource_file",
                {
                    "resource_name": resource_name,
                    "file_name": file_name,
                    "url": adjusted_url,
                },
            )

            try:
                # Ensure the directory exists before writing
                file_dir = os.path.dirname(file_path)
                if not os.path.exists(file_dir):
                    os.makedirs(file_dir, exist_ok=True)

                # Use pypdl to download the file properly
                dl = Pypdl()

                if self.cli_progress:
                    # Start download without blocking and with custom progress tracking
                    dl.start(
                        url=adjusted_url,
                        file_path=file_path,
                        display=False,
                        block=False,
                    )

                    self._handle_download_progress(dl, file_name)
                else:
                    # Use standard download with display=False
                    dl.start(url=adjusted_url, file_path=file_path, display=False)

                # Verify the file was downloaded correctly
                if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                    raise Exception(
                        f"Downloaded file is empty or was not created properly"
                    )

                self.report(
                    "bridges.tools.resource_file_downloaded",
                    {
                        "resource_name": resource_name,
                        "file_name": file_name,
                        "file_path": file_path,
                    },
                )
            except Exception as e:
                self.report(
                    "bridges.tools.resource_file_download_failed",
                    {
                        "resource_name": resource_name,
                        "file_name": file_name,
                        "url": adjusted_url,
                        "error": str(e),
                    },
                )
                raise Exception(
                    f"Failed to download resource file {file_name}: {str(e)}"
                )

        self.report(
            "bridges.tools.resource_downloaded",
            {
                "resource_name": resource_name,
                "resource_path": format_file_path(resource_path),
            },
        )

        return resource_path

    def _is_resource_complete(self, resource_path: str, resource_urls: list) -> bool:
        """
        Check if all resource files exist and are not empty

        Args:
            resource_path: Path to the resource directory
            resource_urls: List of resource URLs to check against

        Returns:
            True if all files exist and are not empty, False otherwise
        """
        from urllib.parse import urlparse

        for resource_url in resource_urls:
            relative_path = self._get_resource_relative_path(resource_url)

            if not relative_path:
                return False

            file_path = os.path.join(resource_path, relative_path)

            if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                return False
        return True

    def _get_resource_relative_path(self, resource_url: str) -> str:
        parsed_url = urlparse(resource_url)
        url_path = parsed_url.path
        markers = ["/resolve/", "/raw/"]

        for marker in markers:
            marker_index = url_path.find(marker)
            if marker_index == -1:
                continue

            after_marker = url_path[marker_index + len(marker) :]
            parts = [part for part in after_marker.split("/") if part]

            if len(parts) > 1:
                relative_path = "/".join(parts[1:])
                relative_path = os.path.normpath(relative_path).lstrip("/\\")
                return relative_path

        return os.path.basename(url_path)

    def _delete_older_binary_versions(
        self, bins_path: str, new_executable: str
    ) -> None:
        """
        Delete older versions of a binary based on filename pattern
        Example: if downloading chatterbox_onnx_1.1.0-linux-x86_64, delete chatterbox_onnx_1.0.0-linux-x86_64

        Args:
            bins_path: Path to the bins directory
            new_executable: Filename of the new binary being downloaded
        """
        try:
            # Parse the new binary filename to extract name, version, and platform
            # Pattern: {name}_{version}-{platform}[.exe]
            match = re.match(r"^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$", new_executable)

            if not match:
                # If filename doesn't match the versioned pattern, skip cleanup
                return

            binary_base_name, new_version, platform = match.groups()

            # Get all files in the bins directory
            if not os.path.exists(bins_path):
                return

            files = os.listdir(bins_path)

            for file in files:
                # Check if this file matches the same binary name and platform but different version
                file_match = re.match(r"^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$", file)

                if not file_match:
                    continue

                file_base_name, file_version, file_platform = file_match.groups()

                # Only delete if:
                # 1. Same binary base name
                # 2. Same platform
                # 3. Different version
                if (
                    file_base_name == binary_base_name
                    and file_platform == platform
                    and file_version != new_version
                ):
                    old_binary_path = os.path.join(bins_path, file)

                    self.report(
                        "bridges.tools.deleting_old_version",
                        {"old_version": file, "new_version": new_executable},
                    )

                    os.remove(old_binary_path)

                    self.report(
                        "bridges.tools.old_version_deleted", {"deleted_file": file}
                    )

        except Exception as e:
            # Don't fail the entire process if cleanup fails
            self.report("bridges.tools.cleanup_warning", {"error": str(e)})

    def _download_binary_on_demand(
        self, binary_name: str, binary_url: str, executable: str
    ) -> None:
        """Download binary on-demand if not found"""

        try:
            bins_path = os.path.join(LEON_TOOLKITS_PATH, self.toolkit, "assets")
            binary_path = os.path.join(bins_path, executable)

            self.report("bridges.tools.binary_not_found", {"binary_name": binary_name})

            self._download_binary(binary_url, binary_path)

            self.report("bridges.tools.binary_downloaded", {"binary_name": binary_name})

            # Delete older versions of this binary
            self._delete_older_binary_versions(bins_path, executable)

            # Make binary executable (Unix systems)
            if not is_windows():
                self.report(
                    "bridges.tools.making_executable", {"binary_name": binary_name}
                )
                os.chmod(binary_path, 0o755)

            # Remove quarantine attribute on macOS to prevent Gatekeeper blocking
            if is_macos():
                self.report(
                    "bridges.tools.removing_quarantine", {"binary_name": binary_name}
                )
                self._remove_quarantine_attribute(binary_path)

        except Exception as e:
            self.report(
                "bridges.tools.download_failed",
                {"binary_name": binary_name, "error": str(e)},
            )
            raise Exception(f"Failed to download binary '{binary_name}': {str(e)}")

    def _remove_quarantine_attribute(self, file_path: str) -> None:
        """Remove macOS quarantine attribute to prevent Gatekeeper blocking"""

        try:
            # Use xattr to remove the com.apple.quarantine extended attribute
            result = subprocess.run(
                ["xattr", "-d", "com.apple.quarantine", file_path],
                capture_output=True,
                check=False,
            )
            if result.returncode == 0:
                self.report(
                    "bridges.tools.quarantine_removed",
                    {"file_name": os.path.basename(file_path)},
                )
            else:
                self.report(
                    "bridges.tools.quarantine_warning",
                    {
                        "file_name": os.path.basename(file_path),
                        "exit_code": str(result.returncode),
                    },
                )
        except Exception as e:
            # Don't fail the entire process if quarantine removal fails
            self.report(
                "bridges.tools.quarantine_exception",
                {"file_name": os.path.basename(file_path), "error": str(e)},
            )

    def _is_archive(self, file_path: str) -> bool:
        """Check if a file is an archive based on its extension"""
        ext = os.path.splitext(file_path)[1].lower()
        basename = os.path.basename(file_path).lower()

        return (
            ext == ".zip"
            or ext == ".tar"
            or basename.endswith(".tar.gz")
            or basename.endswith(".tar.xz")
            or basename.endswith(".tgz")
        )

    def _download_binary(self, url: str, output_path: str) -> None:
        """Download binary from URL using pypdl (faster parallel downloader)
        If the downloaded file is an archive, it will be extracted automatically"""

        try:
            self.report("bridges.tools.downloading_from_url", {})

            # Ensure the directory exists before writing
            file_dir = os.path.dirname(output_path)
            if not os.path.exists(file_dir):
                os.makedirs(file_dir, exist_ok=True)

            # Determine if the URL points to an archive
            parsed_url = urlparse(url)
            is_archive_download = self._is_archive(parsed_url.path)

            # If it's an archive, download to a temporary path with proper extension
            download_path = output_path
            if is_archive_download:
                # Preserve the archive extension for proper extraction
                url_basename = os.path.basename(parsed_url.path)
                if ".tar.gz" in url_basename:
                    archive_ext = ".tar.gz"
                elif ".tar.xz" in url_basename:
                    archive_ext = ".tar.xz"
                elif ".tgz" in url_basename:
                    archive_ext = ".tgz"
                else:
                    archive_ext = os.path.splitext(url_basename)[1]
                download_path = output_path + archive_ext

            # Use pypdl to download the file
            dl = Pypdl()

            if self.cli_progress:
                # Start download without blocking and with custom progress tracking
                dl.start(url=url, file_path=download_path, display=False, block=False)

                self._handle_download_progress(dl, os.path.basename(download_path))
            else:
                # Use standard download with display=False
                dl.start(url=url, file_path=download_path, display=False)

            # Verify the file was downloaded correctly
            if not os.path.exists(download_path) or os.path.getsize(download_path) == 0:
                raise Exception(
                    f"Downloaded binary is empty or was not created properly"
                )

            # If it's an archive, extract it
            if is_archive_download:
                self.report(
                    "bridges.tools.extracting_archive",
                    {"archive_name": os.path.basename(download_path)},
                )

                # Create a temporary extraction directory
                temp_extract_path = output_path + ".extracted"

                # Try extracting without strip first to see the structure
                extract_archive(download_path, temp_extract_path)

                # Find the binary in the extracted directory (recursively if needed)
                def find_binary_file(dir_path):
                    """Find the first file in the directory tree"""
                    try:
                        entries = os.listdir(dir_path)

                        # First, look for files in the current directory
                        for entry in entries:
                            full_path = os.path.join(dir_path, entry)
                            if os.path.isfile(full_path):
                                return full_path

                        # If no files found, look in subdirectories (one level deep)
                        for entry in entries:
                            full_path = os.path.join(dir_path, entry)
                            if os.path.isdir(full_path):
                                found_file = find_binary_file(full_path)
                                if found_file:
                                    return found_file
                    except Exception:
                        pass

                    return None

                binary_file_path = find_binary_file(temp_extract_path)

                if not binary_file_path:
                    raise Exception("Archive extraction resulted in no files")

                # Move the binary to the final output path
                import shutil

                shutil.move(binary_file_path, output_path)

                # Clean up temporary files
                if os.path.exists(download_path):
                    os.remove(download_path)
                if os.path.exists(temp_extract_path):
                    shutil.rmtree(temp_extract_path)

                self.report(
                    "bridges.tools.archive_extracted", {"binary_path": output_path}
                )

        except Exception as e:
            self.report("bridges.tools.download_url_failed", {"error": str(e)})
            raise Exception(f"Failed to download binary: {str(e)}")

    def log(self, message: str, *args: Any) -> None:
        """
        Log debug/progress information to stdout with special prefix to avoid being treated as JSON
        This allows logging without interfering with the JSON communication on stdout

        Args:
            message: The log message
            *args: Additional arguments to log
        """
        # Use a special prefix that the brain can filter out as non-JSON output
        log_message = f"[LEON_TOOL_LOG] {message}"
        if args:
            log_message += " " + " ".join(str(arg) for arg in args)
        sys.stdout.write(log_message + "\n")
        sys.stdout.flush()

    def _handle_download_progress(self, dl: "Pypdl", file_name: str) -> None:
        """
        Handle download progress tracking with custom logging

        Args:
            dl: The Pypdl downloader instance
            file_name: The name of the file being downloaded
        """
        last_logged_percentage = -1
        last_log_time = 0
        LOG_INTERVAL_MS = 2000  # Log every 2 seconds at most
        PERCENTAGE_THRESHOLD = 5  # Log every 5% progress

        dl_any = cast(Any, dl)
        failed = bool(getattr(dl_any, "Failed", False))
        while dl.progress < 100 and not failed:
            current_progress = int(dl.progress)
            current_time = int(time.time() * 1000)

            # Only log if we've made significant progress or enough time has passed
            should_log = (
                current_progress >= last_logged_percentage + PERCENTAGE_THRESHOLD
                or current_time - last_log_time >= LOG_INTERVAL_MS
                or current_progress == 100
            )

            if should_log:
                speed_info = ""
                speed_value = getattr(dl_any, "speed", None)
                if speed_value and speed_value > 0:
                    speed_info = f" at {format_speed(speed_value)}"

                eta_info = ""
                eta_value = getattr(dl_any, "eta", None)
                if eta_value:
                    eta_value_str: str = str(eta_value)
                    formatted_eta = format_eta(eta_value_str)
                    if formatted_eta != "∞":
                        eta_info = f" (ETA: {formatted_eta})"

                size_info = ""
                total_mb = getattr(dl_any, "totalMB", None)
                done_mb = getattr(dl_any, "doneMB", None)
                if total_mb and done_mb:
                    total_bytes = total_mb * 1024 * 1024
                    done_bytes = done_mb * 1024 * 1024
                    size_info = (
                        f" [{format_bytes(done_bytes)}/{format_bytes(total_bytes)}]"
                    )

                progress_line = f"Downloading {file_name}: {current_progress}%{speed_info}{eta_info}{size_info}"
                self.log(progress_line)

                last_logged_percentage = current_progress
                last_log_time = current_time

            # Small delay to prevent busy waiting
            time.sleep(0.1)
            failed = bool(getattr(dl_any, "Failed", False))

        # Log completion
        self.log(f"Download completed: {file_name}")

        if bool(getattr(dl_any, "Failed", False)):
            raise Exception("Download failed")

    def report(
        self,
        key: str,
        data: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None,
    ) -> None:
        """
        Report tool status or information using leon.answer with automatic toolkit/tool context

        Args:
            key: The message key for leon.answer
            data: Optional data dictionary
            tool_group_id: Optional tool group ID for command grouping
        """
        core_data = {
            "isToolOutput": True,
            "toolkitName": self.toolkit,
            "toolName": self.tool_name,
        }

        if tool_group_id:
            core_data["toolGroupId"] = tool_group_id

        leon.answer({"key": key, "data": data or {}, "core": core_data})
