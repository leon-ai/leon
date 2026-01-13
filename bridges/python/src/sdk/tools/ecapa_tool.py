import os

from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig

MODEL_NAME = 'ecapa-voice_gender_classifier'


class ECAPATool(BaseTool):
    """
    Tool for voice gender classification using ECAPA-TDNN model.
    
    Example output format:
    Gender: male
    """

    TOOLKIT = 'music_audio'

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return 'ecapa'

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def detect_gender(
        self,
        input_path: str,
        device: str = 'cpu'
    ) -> str:
        """
        Detect gender from audio file using ECAPA-TDNN voice gender classifier

        Args:
            input_path: The file path of the audio to be analyzed
            device: Device to use for processing (cpu, cuda)

        Returns:
            The detected gender: "male", "female", or "unknown"
        """
        try:
            # Validate input file exists
            if not os.path.exists(input_path):
                raise Exception(f"Input file does not exist: {input_path}")

            # Get model path using the generic resource system
            model_path = self.get_resource_path(MODEL_NAME)

            args = [
                '--function', 'detect_gender',
                '--input', input_path,
                '--model_path', model_path,
                '--device', device
            ]

            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ecapa-voice_gender_classifier',
                args=args,
                options={'sync': True}
            ))

            # Parse the output to extract gender
            gender = self._parse_gender_output(result)

            return gender
        except Exception as e:
            raise Exception(f"Voice gender detection failed: {str(e)}")

    def _parse_gender_output(self, raw_output: str) -> str:
        """
        Parse the gender detection output
        
        Args:
            raw_output: Raw output from the gender detection binary
            
        Returns:
            Detected gender: "male", "female", or "unknown"
        """
        lines = raw_output.split('\n')

        # Look for gender result in the output
        for line in lines:
            lower_line = line.lower().strip()

            if 'gender:' in lower_line:
                # Extract gender from line like "Gender: male"
                import re
                match = re.search(r'gender:\s*(male|female|unknown)', lower_line, re.IGNORECASE)
                if match:
                    return match.group(1).lower()

            # Also check for direct gender output
            if lower_line in ['male', 'female']:
                return lower_line

        # If no clear gender found, return unknown
        return 'unknown'
