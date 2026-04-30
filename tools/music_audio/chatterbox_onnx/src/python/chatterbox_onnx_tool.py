import json
import os
import re
import tempfile
from typing import Optional, Union, List, TypedDict

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.utils import get_platform_name
from bridges.python.src.constants import NVIDIA_LIBS_PATH

MODEL_NAME = "chatterbox-multilingual-onnx"
DEFAULT_MAX_CHARS = 272  # Character limit to avoid hallucination
DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []


def split_text_at_punctuation(
    text: str, max_chars: int = DEFAULT_MAX_CHARS
) -> List[str]:
    """
    Split text at natural punctuation boundaries to avoid hallucination.

    This function ensures no text segment exceeds max_chars by breaking at
    punctuation marks when possible, falling back to spaces or forced splits.

    Args:
        text: The text to split
        max_chars: Maximum characters per segment (default: 272)

    Returns:
        List of text chunks split at natural boundaries
    """
    text = text.strip()
    if len(text) <= max_chars:
        return [text]

    chunks = []
    remaining = text

    while len(remaining) > max_chars:
        # Get segment up to max_chars
        segment = remaining[: max_chars + 1]

        # Look for punctuation followed by space (natural break)
        punctuation_pattern = re.compile(r"[.!?,;:]\s")
        matches = list(punctuation_pattern.finditer(segment))

        if matches:
            # Use the last punctuation match within max_chars
            last_match = matches[-1]
            break_point = (
                last_match.end() - 1
            )  # Don't include the space after punctuation

            # Check if it's in a reasonable position (latter half)
            if break_point > max_chars * 0.5:
                chunks.append(remaining[:break_point].strip())
                remaining = remaining[break_point:].strip()
                continue

        # No good punctuation found, look for last space
        last_space = segment[:max_chars].rfind(" ")
        if last_space > max_chars * 0.3:
            chunks.append(remaining[:last_space].strip())
            remaining = remaining[last_space:].strip()
        else:
            # Force split at max_chars
            chunks.append(remaining[:max_chars].strip())
            remaining = remaining[max_chars:].strip()

    if remaining:
        chunks.append(remaining.strip())

    return chunks


class SynthesisTask(TypedDict, total=False):
    """Type definition for a synthesis task"""

    text: str
    target_language: Optional[str]
    audio_path: str
    # Voice names: https://github.com/leon-ai/leon-binaries/tree/main/bins/chatterbox_onnx/default_voices
    voice_name: Optional[str]
    speaker_reference_path: Optional[str]
    cfg_strength: Optional[float]
    exaggeration: Optional[float]
    temperature: Optional[float]
    # Control automatic text splitting (default: True)
    auto_split: Optional[bool]


class ChatterboxONNXTool(BaseTool):
    """
    Tool for text-to-speech synthesis using Chatterbox ONNX model.
    Supports multilingual synthesis with voice cloning capabilities.
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
        return "chatterbox_onnx"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def synthesize_speech_to_files(
        self,
        tasks: Union[SynthesisTask, List[SynthesisTask]],
        cuda_runtime_path: Optional[str] = None,
    ) -> List[dict]:
        """
        Synthesize speech from text using Chatterbox ONNX

        By default, automatically splits long text (>272 chars) at punctuation boundaries
        to prevent hallucination. Split segments generate separate audio files with
        _part_N suffixes (e.g., output_part_0.wav, output_part_1.wav).

        Args:
            tasks: A single synthesis task or a list of synthesis tasks.
                   Each task should contain:
                   - text: The text to synthesize
                   - audio_path: Output path for the generated audio file
                   - target_language: Optional language code (e.g., 'en', 'zh', 'ja')
                   - voice_name: Optional name of the voice to use
                   - speaker_reference_path: Optional path to a reference audio file for voice cloning
                   - cfg_strength: Optional classifier-free guidance strength (default: 0.5)
                   - exaggeration: Optional exaggeration factor (default: 0.5)
                   - temperature: Optional temperature for sampling (controls randomness)
                   - auto_split: Optional flag to enable/disable automatic text splitting (default: True)
            cuda_runtime_path: Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)

        Returns:
            List of processed tasks (may include split tasks with _part_N suffixes)
        """
        try:
            # Normalize tasks to list
            task_list = tasks if isinstance(tasks, list) else [tasks]

            # Process tasks: split long text into multiple tasks with _part_N suffixes
            tasks_to_synthesize = []

            for task in task_list:
                auto_split = task.get("auto_split", True)  # Default: enabled
                text = task.get("text")
                if not text:
                    raise ValueError("Missing text in synthesis task")
                text = text.strip()
                max_chars = DEFAULT_MAX_CHARS

                # If auto_split disabled or text is short, pass through as-is
                if not auto_split or len(text) <= max_chars:
                    clean_task = {k: v for k, v in task.items() if k != "auto_split"}
                    tasks_to_synthesize.append(clean_task)
                    continue

                # Split long text at punctuation boundaries
                text_chunks = split_text_at_punctuation(text, max_chars)

                # If only one chunk after splitting, no need for special handling
                if len(text_chunks) == 1:
                    clean_task = {k: v for k, v in task.items() if k != "auto_split"}
                    tasks_to_synthesize.append(clean_task)
                    continue

                # Multiple chunks: create separate tasks with _part_N suffixes
                audio_path = task.get("audio_path")
                if not audio_path:
                    raise ValueError("Missing audio_path in synthesis task")
                base_path, ext = os.path.splitext(audio_path)

                for i, chunk in enumerate(text_chunks):
                    chunk_task = {
                        k: v
                        for k, v in task.items()
                        if k not in ["text", "audio_path", "auto_split"]
                    }
                    chunk_task["text"] = chunk
                    chunk_task["audio_path"] = f"{base_path}_part_{i}{ext}"
                    tasks_to_synthesize.append(chunk_task)

            # Get model path using the generic resource system
            model_path = self.get_resource_path(MODEL_NAME)

            # Create a temporary JSON file for the tasks
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            ) as temp_file:
                json_file_path = temp_file.name
                json.dump(tasks_to_synthesize, temp_file, indent=2, ensure_ascii=False)

            args = [
                "--function",
                "synthesize_speech",
                "--json_file",
                json_file_path,
                "--resource_path",
                model_path,
            ]

            # Auto-detect CUDA runtime path if not provided
            platform_name = get_platform_name()
            should_use_cuda = platform_name in ["linux-x86_64", "win-amd64"]
            final_cuda_runtime_path = (
                cuda_runtime_path
                if cuda_runtime_path is not None
                else (NVIDIA_LIBS_PATH if should_use_cuda else None)
            )

            if final_cuda_runtime_path:
                args.extend(["--cuda_runtime_path", final_cuda_runtime_path])

            self.execute_command(
                ExecuteCommandOptions(
                    binary_name="chatterbox_onnx", args=args, options={"sync": True}
                )
            )

            # Return the processed tasks so caller knows which files were created
            return tasks_to_synthesize

        except Exception as e:
            raise Exception(f"Speech synthesis failed: {str(e)}")
