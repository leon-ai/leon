import json
import re
from typing import Optional

from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig
from .schemas import TranscriptionOutput, TranscriptionSegment

MODEL_NAME = 'faster-whisper-large-v3'


class FasterWhisperTool(BaseTool):
    """
    Example output format:

    Detected language: en (probability: 1.00)
    Duration: 26.84 seconds
    ==================================================

    [0.00 -> 5.70] DuckDB, an open-source, fast, embeddable, SQL OLAP database that simplifies the way
    [5.70 -> 10.84] developers implement analytics. It was developed in the Netherlands, written in C++, and first
    [10.84 -> 16.78] released in 2019. And the TLDR is that it's like SQLite, but for columnar data. Everybody knows
    """

    TOOLKIT = 'music_audio'

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return 'faster_whisper'

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def transcribe_to_file(
        self,
        input_path: str,
        output_path: str,
        device: str = 'auto',
        cpu_threads: Optional[int] = None,
        download_root: Optional[str] = None,
        local_files_only: bool = False
    ) -> str:
        """
        Transcribe audio to a file using faster-whisper

        Args:
            input_path: The file path of the audio to be transcribed
            output_path: The desired file path for the transcription output
            device: Device to use for processing (cpu, cuda, auto)
            cpu_threads: Number of CPU threads to use
            download_root: Root directory for model downloads
            local_files_only: Whether to use only local files

        Returns:
            The path to the transcription file
        """
        try:
            # Get model path using the generic resource system
            model_path = self.get_resource_path(MODEL_NAME)

            args = [
                '--function', 'transcribe_to_file',
                '--input', input_path,
                '--output', output_path,
                '--model_size_or_path', model_path,
                '--device', device
            ]

            if cpu_threads:
                args.extend(['--cpu_threads', str(cpu_threads)])

            if download_root:
                args.extend(['--download_root', download_root])

            if local_files_only:
                args.append('--local_files_only')

            self.execute_command(ExecuteCommandOptions(
                binary_name='faster_whisper',
                args=args,
                options={'sync': True}
            ))

            with open(output_path, 'r', encoding='utf-8') as f:
                transcription_content = f.read()

            parsed_output = self._parse_transcription(transcription_content)

            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(parsed_output, f, indent=2, ensure_ascii=False)

            return output_path
        except Exception as e:
            raise Exception(f"Audio transcription failed: {str(e)}")

    def _parse_transcription(self, raw_output: str) -> TranscriptionOutput:
        lines = raw_output.split('\n')

        duration = 0.0
        for line in lines:
            if line.startswith('Duration:'):
                match = re.search(r'Duration:\s+([\d.]+)\s+seconds', line)
                if match:
                    duration = float(match.group(1))
                break

        segments: list[TranscriptionSegment] = []
        segment_regex = re.compile(r'^\[(\d+\.\d+)\s+->\s+(\d+\.\d+)\]\s+(.+)$')

        for line in lines:
            match = segment_regex.match(line)
            if match:
                start = match.group(1)
                end = match.group(2)
                text = match.group(3)

                segments.append({
                    'from': float(start),
                    'to': float(end),
                    'text': text.strip(),
                    'speaker': None
                })

        return {
            'duration': duration,
            'speakers': [],
            'speaker_count': 0,
            'segments': segments,
            'metadata': {
                'tool': self.tool_name
            }
        }
