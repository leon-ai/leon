import json
import os
import re
import tempfile
from typing import Optional

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from tools.music_audio.transcription_schema import TranscriptionOutput, TranscriptionSegment
from bridges.python.src.constants import NVIDIA_LIBS_PATH, PYTORCH_TORCH_PATH

MODEL_NAME = "qwen3-asr-1.7b"
FORCED_ALIGNER_MODEL_NAME = "qwen3-forcedaligner-0.6b"
DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []


class Qwen3ASRTool(BaseTool):
    """
    Example output format:

    I noticed the app has a very mobile-first feel.
    [0.08-0.16s] I
    [0.16-0.64s] noticed
    """

    TOOLKIT = "music_audio"

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return "qwen3_asr"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def transcribe_to_file(
        self,
        input_path: str,
        output_path: str,
        device: str = "auto",
        batch_size: int = 4,
        language: str = "auto",
        return_timestamps: bool = True,
        use_forced_aligner: bool = True,
        cuda_runtime_path: Optional[str] = None,
        torch_path: Optional[str] = None,
        chunk_duration: int = 30,
        cpu_batch_size: Optional[int] = None,
    ) -> str:
        """
        Transcribe audio to a file using Qwen3-ASR

        Args:
            input_path: The file path of the audio to be transcribed
            output_path: The desired file path for the transcription output
            device: Device to use for processing (cpu, cuda, auto)
            batch_size: Batch size for processing
            language: Language code for transcription (auto, en, fr, etc.)
            return_timestamps: Whether to return timestamps in output
            use_forced_aligner: Whether to use the forced aligner model
            cuda_runtime_path: Path to CUDA runtime directory (Linux/Windows only)
            torch_path: Path to PyTorch installation directory
            chunk_duration: Chunk duration in seconds for long audio
            cpu_batch_size: CPU batch size for long audio

        Returns:
            The path to the transcription file
        """
        try:
            if not os.path.isfile(input_path):
                raise FileNotFoundError(f"Input audio file does not exist: {input_path}")

            os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

            model_path = self.get_resource_path(MODEL_NAME)
            forced_aligner_path = None
            nvidia_libs_path = (
                cuda_runtime_path if cuda_runtime_path is not None else NVIDIA_LIBS_PATH
            )
            torch_libs_path = (
                torch_path if torch_path is not None else PYTORCH_TORCH_PATH
            )

            if return_timestamps and use_forced_aligner:
                forced_aligner_path = self.get_resource_path(FORCED_ALIGNER_MODEL_NAME)

            tasks = [
                {
                    "audio_path": input_path,
                    "output_path": output_path,
                }
            ]

            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            ) as temp_file:
                json_file_path = temp_file.name
                json.dump(tasks, temp_file, indent=2, ensure_ascii=False)

            args = [
                "--function",
                "transcribe_audio",
                "--json_file",
                json_file_path,
                "--model_path",
                model_path,
                "--device",
                device,
                "--batch_size",
                str(batch_size),
                "--language",
                language,
                "--return_timestamps",
                "true" if return_timestamps else "false",
                "--chunk_duration",
                str(chunk_duration),
            ]

            if nvidia_libs_path:
                args.extend(["--cuda_runtime_path", nvidia_libs_path])

            if torch_libs_path:
                args.extend(["--torch_path", torch_libs_path])

            if forced_aligner_path:
                args.extend(["--forced_aligner_model_path", forced_aligner_path])

            if cpu_batch_size is not None:
                args.extend(["--cpu_batch_size", str(cpu_batch_size)])

            self.execute_command(
                ExecuteCommandOptions(
                    binary_name="qwen3_asr", args=args, options={"sync": True}
                )
            )

            with open(output_path, "r", encoding="utf-8") as f:
                transcription_content = f.read()

            parsed_output = self.parse_transcription(transcription_content)

            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(parsed_output, f, indent=2, ensure_ascii=False)

            return output_path
        except Exception as e:
            raise Exception(f"Audio transcription failed: {str(e)}")

    def parse_transcription(self, raw_output: str) -> TranscriptionOutput:
        lines = [line.strip() for line in raw_output.split("\n") if line.strip()]

        segments: list[TranscriptionSegment] = []
        segment_regex = re.compile(r"^\[(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s\]\s+(.+)$")
        duration = 0.0

        for line in lines:
            match = segment_regex.match(line)
            if match:
                start = float(match.group(1))
                end = float(match.group(2))
                text = match.group(3)

                segments.append(
                    {"from": start, "to": end, "text": text.strip(), "speaker": None}
                )

                if end > duration:
                    duration = end

        if not segments and lines:
            segments.append({"from": 0.0, "to": 0.0, "text": lines[0], "speaker": None})

        return {
            "duration": duration,
            "speakers": [],
            "speaker_count": 0,
            "segments": segments,
            "metadata": {"tool": self.tool_name},
        }
