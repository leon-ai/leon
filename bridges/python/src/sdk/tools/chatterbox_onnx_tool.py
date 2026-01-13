import json
import os
import tempfile
from typing import Optional, Union, List, TypedDict

from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig
from ..utils import get_platform_name
from ...constants import CUDA_RUNTIME_PATH

MODEL_NAME = 'chatterbox-multilingual-onnx'


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


class ChatterboxONNXTool(BaseTool):
    """
    Tool for text-to-speech synthesis using Chatterbox ONNX model.
    Supports multilingual synthesis with voice cloning capabilities.
    """

    TOOLKIT = 'music_audio'

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return 'chatterbox_onnx'

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def synthesize_speech_to_files(
        self,
        tasks: Union[SynthesisTask, List[SynthesisTask]],
        cuda_runtime_path: Optional[str] = None
    ) -> None:
        """
        Synthesize speech from text using Chatterbox ONNX

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
            cuda_runtime_path: Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)

        Returns:
            None
        """
        try:
            # Normalize tasks to list
            task_list = tasks if isinstance(tasks, list) else [tasks]

            # Get model path using the generic resource system
            model_path = self.get_resource_path(MODEL_NAME)

            # Create a temporary JSON file for the tasks
            with tempfile.NamedTemporaryFile(
                mode='w',
                suffix='.json',
                delete=False,
                encoding='utf-8'
            ) as temp_file:
                json_file_path = temp_file.name
                json.dump(task_list, temp_file, indent=2, ensure_ascii=False)

            try:
                args = [
                    '--function', 'synthesize_speech',
                    '--json_file', json_file_path,
                    '--resource_path', model_path
                ]

                # Auto-detect CUDA runtime path if not provided
                platform_name = get_platform_name()
                should_use_cuda = platform_name in ['linux-x86_64', 'win-amd64']
                final_cuda_runtime_path = cuda_runtime_path if cuda_runtime_path is not None else (CUDA_RUNTIME_PATH if should_use_cuda else None)

                if final_cuda_runtime_path:
                    args.extend(['--cuda_runtime_path', final_cuda_runtime_path])

                self.execute_command(ExecuteCommandOptions(
                    binary_name='chatterbox_onnx',
                    args=args,
                    options={'sync': True}
                ))
            finally:
                # Clean up temporary file
                if os.path.exists(json_file_path):
                    os.remove(json_file_path)

        except Exception as e:
            raise Exception(f"Speech synthesis failed: {str(e)}")
