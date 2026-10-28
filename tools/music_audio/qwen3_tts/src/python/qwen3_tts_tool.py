import json
import os
import tempfile
from typing import (
    Optional,
    Union,
    List,
    TypedDict,
    TypeVar,
    Mapping,
    Any,
    Sequence,
    Literal,
    cast,
)
from collections.abc import Sequence as SequenceABC, Mapping as MappingABC

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.constants import NVIDIA_LIBS_PATH, PYTORCH_TORCH_PATH

MODEL_BASE_NAME = "Qwen3-TTS-12Hz-1.7B-Base"
MODEL_DESIGN_NAME = "Qwen3-TTS-12Hz-1.7B-VoiceDesign"
MODEL_CUSTOM_NAME = "Qwen3-TTS-12Hz-1.7B-CustomVoice"
DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []
MAX_INLINE_TEXT_BYTES = 255
TEXT_FIELDS = (
    "text",
    "reference_text",
    "instruct",
    "design_text",
    "design_instruct",
    "texts",
)

SupportedLanguage = Literal[
    "Auto",
    "Chinese",
    "English",
    "Japanese",
    "Korean",
    "German",
    "French",
    "Russian",
    "Portuguese",
    "Spanish",
    "Italian",
]

TTask = TypeVar("TTask", bound=Mapping[str, Any])


class SynthesizeSpeechTask(TypedDict, total=False):
    text: str
    target_language: Optional[SupportedLanguage]
    language: Optional[SupportedLanguage]
    audio_path: Optional[str]
    output_path: Optional[str]
    speaker_reference_path: Optional[str]
    reference_audio_path: Optional[str]
    reference_text: Optional[str]
    x_vector_only_mode: Optional[bool]
    max_new_tokens: Optional[int]
    do_sample: Optional[bool]
    top_k: Optional[int]
    top_p: Optional[float]
    temperature: Optional[float]
    repetition_penalty: Optional[float]
    subtalker_dosample: Optional[bool]
    subtalker_top_k: Optional[int]
    subtalker_top_p: Optional[float]
    subtalker_temperature: Optional[float]


class DesignVoiceTask(TypedDict, total=False):
    text: str
    target_language: Optional[SupportedLanguage]
    language: Optional[SupportedLanguage]
    instruct: Optional[str]
    audio_path: Optional[str]
    output_path: Optional[str]
    max_new_tokens: Optional[int]
    do_sample: Optional[bool]
    top_k: Optional[int]
    top_p: Optional[float]
    temperature: Optional[float]
    repetition_penalty: Optional[float]
    subtalker_dosample: Optional[bool]
    subtalker_top_k: Optional[int]
    subtalker_top_p: Optional[float]
    subtalker_temperature: Optional[float]


class CustomVoiceTask(TypedDict, total=False):
    text: str
    target_language: Optional[SupportedLanguage]
    language: Optional[SupportedLanguage]
    """
    Vivian for Chinese; Serena for Chinese; Uncle_Fu for Chinese;
    Dylan for Chinese (Beijing dialect); Eric for Chinese (Sichuan dialect);
    Ryan for English; Aiden for English; Ono_Anna for Japanese; Sohee for Korean
    """
    speaker: (
        Literal["Vivian"]
        | Literal["Serena"]
        | Literal["Uncle_Fu"]
        | Literal["Dylan"]
        | Literal["Eric"]
        | Literal["Ryan"]
        | Literal["Aiden"]
        | Literal["Ono_Anna"]
        | Literal["Sohee"]
    )
    instruct: Optional[str]
    audio_path: Optional[str]
    output_path: Optional[str]
    max_new_tokens: Optional[int]
    do_sample: Optional[bool]
    top_k: Optional[int]
    top_p: Optional[float]
    temperature: Optional[float]
    repetition_penalty: Optional[float]
    subtalker_dosample: Optional[bool]
    subtalker_top_k: Optional[int]
    subtalker_top_p: Optional[float]
    subtalker_temperature: Optional[float]


class DesignThenSynthesizeTask(TypedDict, total=False):
    design_text: str
    design_language: Optional[SupportedLanguage]
    design_instruct: Optional[str]
    texts: List[str]
    languages: Optional[List[SupportedLanguage]]
    output_paths: List[str]
    design_max_new_tokens: Optional[int]
    design_do_sample: Optional[bool]
    design_top_k: Optional[int]
    design_top_p: Optional[float]
    design_temperature: Optional[float]
    design_repetition_penalty: Optional[float]
    design_subtalker_dosample: Optional[bool]
    design_subtalker_top_k: Optional[int]
    design_subtalker_top_p: Optional[float]
    design_subtalker_temperature: Optional[float]
    max_new_tokens: Optional[int]
    do_sample: Optional[bool]
    top_k: Optional[int]
    top_p: Optional[float]
    temperature: Optional[float]
    repetition_penalty: Optional[float]
    subtalker_dosample: Optional[bool]
    subtalker_top_k: Optional[int]
    subtalker_top_p: Optional[float]
    subtalker_temperature: Optional[float]


class Qwen3TTSTool(BaseTool):
    """
    Tool for text-to-speech, voice cloning, and voice design using Qwen3-TTS.
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
        return "qwen3_tts"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def synthesize_speech(
        self,
        tasks: Union[SynthesizeSpeechTask, List[SynthesizeSpeechTask]],
        device: str = "auto",
        nvidia_libs_path: Optional[str] = None,
        torch_path: Optional[str] = None,
    ) -> List[SynthesizeSpeechTask]:
        return self._run_tasks(
            "synthesize_speech",
            tasks,
            [MODEL_BASE_NAME],
            device,
            nvidia_libs_path,
            torch_path,
        )

    def design_voice(
        self,
        tasks: Union[DesignVoiceTask, List[DesignVoiceTask]],
        device: str = "auto",
        nvidia_libs_path: Optional[str] = None,
        torch_path: Optional[str] = None,
    ) -> List[DesignVoiceTask]:
        return self._run_tasks(
            "design_voice",
            tasks,
            [MODEL_DESIGN_NAME],
            device,
            nvidia_libs_path,
            torch_path,
        )

    def custom_voice(
        self,
        tasks: Union[CustomVoiceTask, List[CustomVoiceTask]],
        device: str = "auto",
        nvidia_libs_path: Optional[str] = None,
        torch_path: Optional[str] = None,
    ) -> List[CustomVoiceTask]:
        return self._run_tasks(
            "custom_voice",
            tasks,
            [MODEL_CUSTOM_NAME],
            device,
            nvidia_libs_path,
            torch_path,
        )

    def design_then_synthesize(
        self,
        tasks: Union[DesignThenSynthesizeTask, List[DesignThenSynthesizeTask]],
        device: str = "auto",
        nvidia_libs_path: Optional[str] = None,
        torch_path: Optional[str] = None,
    ) -> List[DesignThenSynthesizeTask]:
        return self._run_tasks(
            "design_then_synthesize",
            tasks,
            [MODEL_DESIGN_NAME, MODEL_BASE_NAME],
            device,
            nvidia_libs_path,
            torch_path,
        )

    def _resolve_resource_root(self, model_names: List[str]) -> str:
        model_paths = [self.get_resource_path(model_name) for model_name in model_names]
        roots = {os.path.dirname(model_path) for model_path in model_paths}

        if len(roots) != 1:
            raise Exception(
                f"Mismatched resource roots for models: {', '.join(model_names)}"
            )

        return os.path.dirname(model_paths[0]) if model_paths else ""

    def _run_tasks(
        self,
        function_name: str,
        tasks: Union[TTask, Sequence[TTask]],
        model_names: List[str],
        device: str,
        nvidia_libs_path: Optional[str],
        torch_path: Optional[str],
    ) -> List[TTask]:
        if isinstance(tasks, MappingABC):
            task_list = [cast(TTask, tasks)]
        elif isinstance(tasks, SequenceABC):
            task_list = cast(List[TTask], list(tasks))
        else:
            task_list = [cast(TTask, tasks)]

        temp_dir = None

        try:
            resource_root = self._resolve_resource_root(model_names)
            final_nvidia_libs_path = (
                nvidia_libs_path if nvidia_libs_path is not None else NVIDIA_LIBS_PATH
            )
            final_torch_path = (
                torch_path if torch_path is not None else PYTORCH_TORCH_PATH
            )

            temp_dir = tempfile.TemporaryDirectory(prefix="qwen3_tts_tasks_")
            json_file_path = os.path.join(temp_dir.name, "tasks.json")

            # The CLI probes text as a filename. Send long literals through text
            # files to avoid filename-length errors, preserving existing file inputs.
            binary_tasks = []
            for task_index, task in enumerate(task_list):
                binary_task = dict(task)
                for field in TEXT_FIELDS:
                    if field not in task:
                        continue

                    value = task[field]
                    texts = value if isinstance(value, list) else [value]
                    staged_texts = []
                    for text_index, text in enumerate(texts):
                        if (
                            not isinstance(text, str)
                            or len(text.encode("utf-8")) <= MAX_INLINE_TEXT_BYTES
                            or os.path.isfile(text)
                        ):
                            staged_texts.append(text)
                            continue

                        text_path = os.path.join(
                            temp_dir.name, f"{task_index}-{field}-{text_index}.txt"
                        )
                        with open(text_path, "w", encoding="utf-8") as text_file:
                            text_file.write(text)
                        staged_texts.append(text_path)

                    binary_task[field] = (
                        staged_texts if isinstance(value, list) else staged_texts[0]
                    )
                binary_tasks.append(binary_task)

            with open(json_file_path, "w", encoding="utf-8") as temp_file:
                json.dump(binary_tasks, temp_file, indent=2, ensure_ascii=False)

            args = [
                "--function",
                function_name,
                "--json_file",
                json_file_path,
                "--resource_path",
                resource_root,
                "--device",
                device,
                "--torch_path",
                final_torch_path,
            ]

            if final_nvidia_libs_path:
                args.extend(["--nvidia_libs_path", final_nvidia_libs_path])

            self.execute_command(
                ExecuteCommandOptions(
                    binary_name="qwen3_tts", args=args, options={"sync": True}
                )
            )

            return task_list
        except Exception as e:
            raise Exception(f"Qwen3-TTS execution failed: {str(e)}")
        finally:
            if temp_dir:
                temp_dir.cleanup()
