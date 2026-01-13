import os
import re
from abc import ABC, abstractmethod
from typing import Callable, Dict, Optional, Union, List, Any
from pypdl import Pypdl
from urllib.parse import urlparse
from .toolkit_config import ToolkitConfig
from .leon import leon
from .utils import is_windows, is_macos, set_hugging_face_url, format_bytes, format_speed, format_eta, format_file_path
from ..constants import TOOLKITS_PATH
import subprocess
import sys
import time

# Progress callback type for reporting tool progress
ProgressCallback = Callable[[Dict[str, Optional[Union[str, int, float]]]], None]


# Command execution options
class ExecuteCommandOptions:
    def __init__(
        self,
        binary_name: str,
        args: List[str],
        options: Optional[Dict[str, Any]] = None,
        on_progress: Optional[ProgressCallback] = None,
        on_output: Optional[Callable[[str, bool], None]] = None,
        skip_binary_download: bool = False
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

    def _escape_shell_arg(self, arg: str) -> str:
        """
        Escape shell argument by escaping special characters with backslashes
        This follows the Unix/Linux shell escaping convention
        """
        # Don't escape URLs - they have their own structure
        try:
            parsed = urlparse(arg)
            # If urlparse succeeds and has a scheme, it's likely a valid URL
            if parsed.scheme:
                return arg
        except Exception:
            # Not a valid URL, continue with normal escaping
            pass

        if is_windows():
            # Windows: wrap in double quotes and escape internal quotes
            if ' ' in arg or '"' in arg or '&' in arg or '|' in arg:
                return f'"{arg.replace(chr(34), chr(92) + chr(34))}"'  # Replace " with \"
            return arg
        else:
            # Unix/Linux: escape special characters with backslashes
            return re.sub(r'(["\s\'$`\\(){}[\]|&;<>*?!])', r'\\\1', arg)

    def execute_command(self, options: ExecuteCommandOptions) -> str:
        """Execute a command with proper Leon messaging and progress tracking"""

        binary_name = options.binary_name
        args = options.args
        exec_options = options.options
        on_progress = options.on_progress
        on_output = options.on_output
        skip_binary_download = options.skip_binary_download

        sync = exec_options.get('sync', True) if exec_options else True

        # Get binary path (auto-downloads if needed)
        binary_path = self.get_binary_path(binary_name, skip_binary_download)
        command_string = f'"{binary_path}" {" ".join([self._escape_shell_arg(arg) for arg in args])}'

        # Generate a unique group ID for this command execution
        tool_group_id = f"{self.toolkit}_{self.tool_name}_{int(time.time() * 1000)}"

        self.report('bridges.tools.executing_command', {
            'binary_name': binary_name,
            'command': command_string
        }, tool_group_id)

        if sync:
            return self._execute_sync_command(binary_path, args, command_string, exec_options, tool_group_id)
        else:
            return self._execute_async_command(binary_path, args, command_string, exec_options, tool_group_id,
                                               on_progress, on_output)

    def _execute_sync_command(
        self,
        binary_path: str,
        args: List[str],
        command_string: str,
        exec_options: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None
    ) -> str:
        """Execute command synchronously"""

        try:
            start_time = time.time()

            result = subprocess.run(
                command_string,
                capture_output=True,
                text=True,
                shell=True,
                timeout=exec_options.get('timeout') if exec_options else None,
                cwd=exec_options.get('cwd') if exec_options else None
            )

            execution_time = int((time.time() - start_time) * 1000)

            if result.returncode == 0:
                self.report('bridges.tools.command_completed', {
                    'command': command_string,
                    'execution_time': f'{execution_time}ms'
                }, tool_group_id)
                return result.stdout
            else:
                self.report('bridges.tools.command_failed', {
                    'command': command_string,
                    'error': result.stderr or 'Unknown error',
                    'exit_code': str(result.returncode),
                    'execution_time': f'{execution_time}ms'
                }, tool_group_id)
                raise Exception(f"Command failed with exit code {result.returncode}: {result.stderr}")

        except subprocess.TimeoutExpired as e:
            self.report('bridges.tools.command_timeout', {
                'command': command_string,
                'timeout': f'{e.timeout}s' if e.timeout else 'unknown'
            }, tool_group_id)
            raise Exception(f"Command timed out after {e.timeout}s")
        except Exception as e:
            self.report('bridges.tools.command_error', {
                'command': command_string,
                'error': str(e)
            }, tool_group_id)
            raise

    def _execute_async_command(
        self,
        binary_path: str,
        args: List[str],
        command_string: str,
        exec_options: Optional[Dict[str, Any]] = None,
        tool_group_id: Optional[str] = None,
        on_progress: Optional[ProgressCallback] = None,
        on_output: Optional[Callable[[str, bool], None]] = None
    ) -> str:
        """Execute command asynchronously with progress tracking"""

        try:
            start_time = time.time()
            output_buffer = ''

            process = subprocess.Popen(
                [binary_path] + args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=exec_options.get('cwd') if exec_options else None
            )

            # Read output in real time
            while True:
                stdout_line = process.stdout.readline() if process.stdout else ''
                stderr_line = process.stderr.readline() if process.stderr else ''

                if stdout_line:
                    output_buffer += stdout_line
                    if on_output:
                        on_output(stdout_line, False)
                    if on_progress:
                        on_progress({'status': 'running'})

                if stderr_line:
                    output_buffer += stderr_line
                    if on_output:
                        on_output(stderr_line, True)

                if process.poll() is not None:
                    break

            execution_time = int((time.time() - start_time) * 1000)

            if process.returncode == 0:
                self.report('bridges.tools.command_completed', {
                    'command': command_string,
                    'execution_time': f'{execution_time}ms'
                }, tool_group_id)
                if on_progress:
                    on_progress({'status': 'completed', 'percentage': 100})
                return output_buffer
            else:
                self.report('bridges.tools.command_failed', {
                    'command': command_string,
                    'exit_code': str(process.returncode),
                    'execution_time': f'{execution_time}ms'
                }, tool_group_id)
                raise Exception(f"Command failed with exit code {process.returncode}: {output_buffer}")

        except Exception as e:
            self.report('bridges.tools.command_error', {
                'command': command_string,
                'error': str(e)
            }, tool_group_id)
            raise

    def get_binary_path(self, binary_name: str, skip_binary_download: bool = False) -> str:
        """Get binary path and ensure it's downloaded"""
        from urllib.parse import urlparse

        # For built-in commands like bash, just return the binary name
        if skip_binary_download:
            return binary_name

        # Get tool name without "Tool" suffix for config lookup
        tool_config_name = self.tool_name.lower().replace('tool', '')
        config = ToolkitConfig.load(self.toolkit, tool_config_name)
        binary_url = ToolkitConfig.get_binary_url(config)

        self.report('bridges.tools.checking_binary', {
            'binary_name': binary_name
        })
        if not binary_url:
            self.report('bridges.tools.no_binary_url', {
                'binary_name': binary_name
            })
            raise Exception(f"No download URL found for binary '{binary_name}'")

        # Extract the actual filename from the URL
        parsed_url = urlparse(binary_url)
        actual_filename = os.path.basename(parsed_url.path)
        executable = f"{actual_filename}.exe" if is_windows() and not actual_filename.endswith(
            '.exe') else actual_filename

        bins_path = os.path.join(TOOLKITS_PATH, self.toolkit, 'bins')

        # Ensure toolkit bins directory exists
        if not os.path.exists(bins_path):
            self.report('bridges.tools.creating_bins_directory', {
                'toolkit': self.toolkit
            })
            os.makedirs(bins_path, exist_ok=True)

        binary_path = os.path.join(bins_path, executable)

        # Ensure binary is available before returning path
        if not os.path.exists(binary_path):
            self._download_binary_on_demand(binary_name, binary_url, executable)

        # Force chmod again in case it has been downloaded but somehow failed
        # so it could not chmod correctly earlier
        if not is_windows():
            self.report('bridges.tools.applying_permissions', {
                'binary_name': binary_name
            })
            os.chmod(binary_path, 0o755)

        self.report('bridges.tools.binary_ready', {
            'binary_name': binary_name
        })

        return binary_path

    def get_resource_path(self, resource_name: str) -> str:
        """
        Get resource path and ensure all resource files are downloaded

        Args:
            resource_name: The name of the resource as defined in toolkit.json

        Returns:
            The path to the resource directory
        """
        from urllib.parse import urlparse

        # Get tool name without "Tool" suffix for config lookup
        tool_config_name = self.tool_name.lower().replace('tool', '')
        config = ToolkitConfig.load(self.toolkit, tool_config_name)
        resource_urls = config.get('resources', {}).get(resource_name)

        self.report('bridges.tools.checking_resource', {
            'resource_name': resource_name
        })

        if not resource_urls or not isinstance(resource_urls, list) or len(resource_urls) == 0:
            self.report('bridges.tools.no_resource_urls', {
                'resource_name': resource_name
            })
            raise Exception(f"No download URLs found for resource '{resource_name}'")

        resource_path = os.path.join(TOOLKITS_PATH, self.toolkit, 'bins', resource_name)

        # Ensure resource directory exists
        if not os.path.exists(resource_path):
            self.report('bridges.tools.creating_resource_directory', {
                'resource_name': resource_name,
                'resource_path': format_file_path(resource_path)
            })
            os.makedirs(resource_path, exist_ok=True)

        # Check if all resource files exist and are complete
        if self._is_resource_complete(resource_path, resource_urls):
            self.report('bridges.tools.resource_already_exists', {
                'resource_name': resource_name,
                'resource_path': format_file_path(resource_path)
            })
            return resource_path

        self.report('bridges.tools.downloading_resource', {
            'resource_name': resource_name
        })

        # Download each resource file
        for resource_url in resource_urls:
            adjusted_url = set_hugging_face_url(resource_url)

            # Extract filename from URL
            parsed_url = urlparse(adjusted_url)
            file_name = os.path.basename(parsed_url.path).split('?')[0]  # Remove query parameters
            file_path = os.path.join(resource_path, file_name)

            self.report('bridges.tools.downloading_resource_file', {
                'resource_name': resource_name,
                'file_name': file_name,
                'url': adjusted_url
            })

            try:
                # Ensure the directory exists before writing
                file_dir = os.path.dirname(file_path)
                if not os.path.exists(file_dir):
                    os.makedirs(file_dir, exist_ok=True)

                # Use pypdl to download the file properly
                dl = Pypdl()

                if self.cli_progress:
                    # Start download without blocking and with custom progress tracking
                    dl.start(url=adjusted_url, file_path=file_path, display=False, block=False)

                    self._handle_download_progress(dl, file_name)
                else:
                    # Use standard download with display=False
                    dl.start(url=adjusted_url, file_path=file_path, display=False)

                # Verify the file was downloaded correctly
                if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                    raise Exception(f"Downloaded file is empty or was not created properly")

                self.report('bridges.tools.resource_file_downloaded', {
                    'resource_name': resource_name,
                    'file_name': file_name,
                    'file_path': file_path
                })
            except Exception as e:
                self.report('bridges.tools.resource_file_download_failed', {
                    'resource_name': resource_name,
                    'file_name': file_name,
                    'url': adjusted_url,
                    'error': str(e)
                })
                raise Exception(f"Failed to download resource file {file_name}: {str(e)}")

        self.report('bridges.tools.resource_downloaded', {
            'resource_name': resource_name,
            'resource_path': format_file_path(resource_path)
        })

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
            parsed_url = urlparse(resource_url)
            file_name = os.path.basename(parsed_url.path).split('?')[0]  # Remove query parameters
            file_path = os.path.join(resource_path, file_name)

            if not os.path.exists(file_path) or os.path.getsize(file_path) == 0:
                return False
        return True

    def _delete_older_binary_versions(self, bins_path: str, new_executable: str) -> None:
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
            match = re.match(r'^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$', new_executable)
            
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
                file_match = re.match(r'^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$', file)
                
                if not file_match:
                    continue
                
                file_base_name, file_version, file_platform = file_match.groups()
                
                # Only delete if:
                # 1. Same binary base name
                # 2. Same platform
                # 3. Different version
                if (file_base_name == binary_base_name and
                    file_platform == platform and
                    file_version != new_version):
                    
                    old_binary_path = os.path.join(bins_path, file)
                    
                    self.report('bridges.tools.deleting_old_version', {
                        'old_version': file,
                        'new_version': new_executable
                    })
                    
                    os.remove(old_binary_path)
                    
                    self.report('bridges.tools.old_version_deleted', {
                        'deleted_file': file
                    })
                    
        except Exception as e:
            # Don't fail the entire process if cleanup fails
            self.report('bridges.tools.cleanup_warning', {
                'error': str(e)
            })

    def _download_binary_on_demand(self, binary_name: str, binary_url: str, executable: str) -> None:
        """Download binary on-demand if not found"""

        try:
            bins_path = os.path.join(TOOLKITS_PATH, self.toolkit, 'bins')
            binary_path = os.path.join(bins_path, executable)

            self.report('bridges.tools.binary_not_found', {
                'binary_name': binary_name
            })

            self._download_binary(binary_url, binary_path)

            self.report('bridges.tools.binary_downloaded', {
                'binary_name': binary_name
            })

            # Delete older versions of this binary
            self._delete_older_binary_versions(bins_path, executable)

            # Make binary executable (Unix systems)
            if not is_windows():
                self.report('bridges.tools.making_executable', {
                    'binary_name': binary_name
                })
                os.chmod(binary_path, 0o755)

            # Remove quarantine attribute on macOS to prevent Gatekeeper blocking
            if is_macos():
                self.report('bridges.tools.removing_quarantine', {
                    'binary_name': binary_name
                })
                self._remove_quarantine_attribute(binary_path)

        except Exception as e:
            self.report('bridges.tools.download_failed', {
                'binary_name': binary_name,
                'error': str(e)
            })
            raise Exception(f"Failed to download binary '{binary_name}': {str(e)}")

    def _remove_quarantine_attribute(self, file_path: str) -> None:
        """Remove macOS quarantine attribute to prevent Gatekeeper blocking"""

        try:
            # Use xattr to remove the com.apple.quarantine extended attribute
            result = subprocess.run(['xattr', '-d', 'com.apple.quarantine', file_path],
                                    capture_output=True, check=False)
            if result.returncode == 0:
                self.report('bridges.tools.quarantine_removed', {
                    'file_name': os.path.basename(file_path)
                })
            else:
                self.report('bridges.tools.quarantine_warning', {
                    'file_name': os.path.basename(file_path),
                    'exit_code': str(result.returncode)
                })
        except Exception as e:
            # Don't fail the entire process if quarantine removal fails
            self.report('bridges.tools.quarantine_exception', {
                'file_name': os.path.basename(file_path),
                'error': str(e)
            })

    def _download_binary(self, url: str, output_path: str) -> None:
        """Download binary from URL using pypdl (faster parallel downloader)"""

        try:
            self.report('bridges.tools.downloading_from_url', {})

            # Ensure the directory exists before writing
            file_dir = os.path.dirname(output_path)
            if not os.path.exists(file_dir):
                os.makedirs(file_dir, exist_ok=True)

            # Use pypdl to download the file
            dl = Pypdl()

            if self.cli_progress:
                # Start download without blocking and with custom progress tracking
                dl.start(url=url, file_path=output_path, display=False, block=False)

                self._handle_download_progress(dl, os.path.basename(output_path))
            else:
                # Use standard download with display=False
                dl.start(url=url, file_path=output_path, display=False)

            # Verify the file was downloaded correctly
            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                raise Exception(f"Downloaded binary is empty or was not created properly")

        except Exception as e:
            self.report('bridges.tools.download_url_failed', {
                'error': str(e)
            })
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
        sys.stdout.write(log_message + '\n')
        sys.stdout.flush()

    def _handle_download_progress(self, dl: 'Pypdl', file_name: str) -> None:
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

        while dl.progress < 100 and not dl.Failed:
            current_progress = int(dl.progress)
            current_time = int(time.time() * 1000)

            # Only log if we've made significant progress or enough time has passed
            should_log = (
                current_progress >= last_logged_percentage + PERCENTAGE_THRESHOLD or
                current_time - last_log_time >= LOG_INTERVAL_MS or
                current_progress == 100
            )

            if should_log:
                speed_info = ""
                if dl.speed and dl.speed > 0:
                    speed_info = f" at {format_speed(dl.speed)}"

                eta_info = ""
                if dl.eta:
                    formatted_eta = format_eta(dl.eta)
                    if formatted_eta != "∞":
                        eta_info = f" (ETA: {formatted_eta})"

                size_info = ""
                if dl.totalMB and dl.doneMB:
                    total_bytes = dl.totalMB * 1024 * 1024
                    done_bytes = dl.doneMB * 1024 * 1024
                    size_info = f" [{format_bytes(done_bytes)}/{format_bytes(total_bytes)}]"

                progress_line = f"Downloading {file_name}: {current_progress}%{speed_info}{eta_info}{size_info}"
                self.log(progress_line)

                last_logged_percentage = current_progress
                last_log_time = current_time

            # Small delay to prevent busy waiting
            time.sleep(0.1)

        # Log completion
        self.log(f"Download completed: {file_name}")

        if dl.Failed:
            raise Exception("Download failed")

    def report(self, key: str, data: Optional[Dict[str, Any]] = None, tool_group_id: Optional[str] = None) -> None:
        """
        Report tool status or information using leon.answer with automatic toolkit/tool context
        
        Args:
            key: The message key for leon.answer
            data: Optional data dictionary
            tool_group_id: Optional tool group ID for command grouping
        """
        core_data = {
            'isToolOutput': True,
            'toolkitName': self.toolkit,
            'toolName': self.tool_name
        }

        if tool_group_id:
            core_data['toolGroupId'] = tool_group_id

        leon.answer({
            'key': key,
            'data': data or {},
            'core': core_data
        })
