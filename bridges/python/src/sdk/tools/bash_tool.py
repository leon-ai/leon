import os
from typing import Dict, Any, Optional
from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig


class BashTool(BaseTool):
    TOOLKIT = 'operating_system_control'

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        tool_config_name = self.__class__.__name__.lower().replace('tool', '')
        self.config = ToolkitConfig.load(self.TOOLKIT, tool_config_name)

    @property
    def tool_name(self) -> str:
        return self.__class__.__name__

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def execute_bash_command(
            self,
            command: str,
            cwd: Optional[str] = None,
            timeout: Optional[int] = 30,
            capture_output: bool = True
    ) -> Dict[str, Any]:
        """
        Execute a bash command and return the result.
        
        Args:
            command: The bash command to execute
            cwd: Working directory for the command
            timeout: Command timeout in seconds (default: 30)
            capture_output: Whether to capture stdout/stderr (default: True)
            
        Returns:
            Dict with keys: success, stdout, stderr, returncode, command
        """

        try:
            # Use shell execution via the base tool's command execution method
            # Split command into binary and args for proper execution
            # For bash commands, we'll use 'bash' as the binary and '-c' with the command as args
            result_output = self.execute_command(ExecuteCommandOptions(
                binary_name='bash',
                args=['-c', command],
                options={
                    'sync': True,
                    'cwd': cwd or os.getcwd(),
                    'timeout': timeout
                },
                skip_binary_download=True  # bash is a built-in command, no need to download
            ))

            return {
                'success': True,
                'stdout': result_output.strip(),
                'stderr': '',
                'returncode': 0,
                'command': command
            }

        except Exception as e:
            error_message = str(e)

            # Parse error to determine if it was a timeout, command failure, or other error
            if 'timed out' in error_message.lower():
                return {
                    'success': False,
                    'stdout': '',
                    'stderr': f'Command timed out after {timeout} seconds',
                    'returncode': -1,
                    'command': command
                }
            elif 'failed with exit code' in error_message:
                # Extract exit code and error from the base tool's error message
                import re
                exit_code_match = re.search(r'exit code (\d+)', error_message)
                exit_code = int(exit_code_match.group(1)) if exit_code_match else -1

                # Extract stderr from the error message if present
                stderr_match = re.search(r'exit code \d+: (.+)$', error_message)
                stderr = stderr_match.group(1) if stderr_match else error_message

                return {
                    'success': False,
                    'stdout': '',
                    'stderr': stderr,
                    'returncode': exit_code,
                    'command': command
                }
            else:
                return {
                    'success': False,
                    'stdout': '',
                    'stderr': error_message,
                    'returncode': -1,
                    'command': command
                }

    def is_safe_command(self, command: str) -> bool:
        """
        Basic safety check for bash commands.
        Returns True if command appears safe to execute.
        """

        # List of dangerous command patterns
        dangerous_patterns = [
            'rm -rf /',
            'rm -rf /*',
            'mkfs',
            'dd if=',
            'format',
            'fdisk',
            '> /dev/',
            'chmod 777 /',
            'chown -R',
            'kill -9 -1',
            'killall -9',
            'fork()',
            'while true; do',
            'curl | sh',
            'wget | sh',
            '| bash',
            '| sh',
            'eval $(curl',
            'eval $(wget'
        ]

        command_lower = command.lower()

        # Check for dangerous patterns
        for pattern in dangerous_patterns:
            if pattern in command_lower:
                return False

        return True

    def get_command_risk_level(self, command: str) -> str:
        """
        Assess the risk level of a command.
        Returns: 'low', 'medium', 'high', or 'critical'
        """

        command_lower = command.lower()

        # Critical risk commands
        critical_patterns = [
            'rm -rf /',
            'rm -rf /*',
            'mkfs',
            'format',
            'fdisk',
            'kill -9 -1'
        ]

        # High risk commands  
        high_risk_patterns = [
            'rm -rf',
            'rm -f',
            'chmod 777',
            'chown -R',
            'dd if=',
            'killall',
            'pkill',
            'sudo su',
            'curl | sh',
            'wget | sh'
        ]

        # Medium risk commands
        medium_risk_patterns = [
            'sudo',
            'rm ',
            'mv ',
            'cp ',
            'chmod',
            'chown',
            'install',
            'apt ',
            'yum ',
            'brew ',
            'pip install'
        ]

        risk_level = 'low'
        for pattern in critical_patterns:
            if pattern in command_lower:
                risk_level = 'critical'
                break

        if risk_level == 'low':
            for pattern in high_risk_patterns:
                if pattern in command_lower:
                    risk_level = 'high'
                    break

        if risk_level == 'low':
            for pattern in medium_risk_patterns:
                if pattern in command_lower:
                    risk_level = 'medium'
                    break

        return risk_level

    def get_risk_description(self, command: str) -> str:
        """
        Get a human-readable description of the command's risk.
        """
        risk_level = self.get_command_risk_level(command)
        command_lower = command.lower()

        if 'rm' in command_lower:
            return 'delete files or directories permanently'
        elif 'sudo' in command_lower:
            return 'make system-level changes with elevated privileges'
        elif 'kill' in command_lower:
            return 'terminate running processes'
        elif 'chmod' in command_lower or 'chown' in command_lower:
            return 'change file permissions or ownership'
        elif any(pkg in command_lower for pkg in ['apt', 'yum', 'brew', 'pip']):
            return 'install or modify system packages'
        elif 'curl' in command_lower or 'wget' in command_lower:
            return 'download content from the internet'
        else:
            return {
                'critical': 'cause severe system damage',
                'high': 'cause significant system changes',
                'medium': 'modify your system',
                'low': 'perform system operations'
            }.get(risk_level, 'affect your system')
