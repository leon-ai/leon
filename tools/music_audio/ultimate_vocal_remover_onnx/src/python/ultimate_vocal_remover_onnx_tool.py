import json
import os
import tempfile
from typing import Optional, Union, List, TypedDict

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.utils import get_platform_name
from bridges.python.src.constants import NVIDIA_LIBS_PATH

MODEL_NAME = "ultimate-vocal-remover-onnx"
DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []


class VocalSeparationTask(TypedDict, total=False):
    """Type definition for a vocal separation task"""

    audio_path: str
    vocal_output_path: str
    instrumental_output_path: str
    aggression: Optional[float]


class UltimateVocalRemoverONNXTool(BaseTool):
    """
    Tool for vocal separation using the Ultimate Vocal Remover ONNX model.
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
        return "ultimate_vocal_remover_onnx"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def separate_vocals(
        self,
        tasks: Union[VocalSeparationTask, List[VocalSeparationTask]],
        cuda_runtime_path: Optional[str] = None,
    ) -> None:
        """
        Separate vocals from audio using Ultimate Vocal Remover ONNX

        Args:
            tasks: A single vocal separation task or a list of vocal separation tasks.
                   Each task should contain:
                   - audio_path: Input path for the audio file
                   - vocal_output_path: Output path for the generated vocal file
                   - instrumental_output_path: Output path for the generated instrumental file
                   - aggression: Optional aggression factor (default: 1.3)
            cuda_runtime_path: Optional path to CUDA runtime for GPU acceleration (auto-detected if not provided)

        Returns:
            None
        """
        try:
            # Normalize tasks to list
            task_list = tasks if isinstance(tasks, list) else [tasks]

            # Get model path using the generic resource system
            resource_dir = self.get_resource_path(MODEL_NAME)
            model_path = os.path.join(resource_dir, "UVR-MDX-NET-Inst_HQ_3.onnx")

            # Create a temporary JSON file for the tasks
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".json", delete=False, encoding="utf-8"
            ) as temp_file:
                json_file_path = temp_file.name
                json.dump(task_list, temp_file, indent=2, ensure_ascii=False)

            args = [
                "--function",
                "separate_vocals",
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
                    binary_name="ultimate_vocal_remover_onnx",
                    args=args,
                    options={"sync": True},
                )
            )

        except Exception as e:
            raise Exception(f"Vocal separation failed: {str(e)}")
