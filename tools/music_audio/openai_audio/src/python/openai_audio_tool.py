import json
from typing import List, Dict, Any, Optional

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network
from tools.music_audio.transcription_schema import TranscriptionOutput, TranscriptionSegment

# Hardcoded default settings for OpenAI audio tool
OPENAI_AUDIO_API_KEY = None
OPENAI_AUDIO_MODEL = "whisper-1"
DEFAULT_SETTINGS = {
    "OPENAI_AUDIO_API_KEY": OPENAI_AUDIO_API_KEY,
    "OPENAI_AUDIO_MODEL": OPENAI_AUDIO_MODEL,
}
REQUIRED_SETTINGS = ["OPENAI_AUDIO_API_KEY"]


class OpenAIAudioTool(BaseTool):
    TOOLKIT = "music_audio"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

        tool_settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.settings = tool_settings
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

        # Priority: toolkit settings > hardcoded default
        self.api_key = self.settings.get("OPENAI_AUDIO_API_KEY", OPENAI_AUDIO_API_KEY)
        self.model = self.settings.get("OPENAI_AUDIO_MODEL", OPENAI_AUDIO_MODEL)

        self.network = Network({"base_url": "https://api.openai.com"})

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return "openai_audio"

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
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> str:
        """
        Transcribe audio to a file using OpenAI's audio transcription API via SDK Network

        Args:
            input_path: Path to the audio file to transcribe
            output_path: Path to save the JSON transcription (unified format)
            api_key: OpenAI API key (uses env/hardcoded default if not provided)
            model: Transcription model (defaults to tool default)

        Returns:
            The path to the transcription file
        """
        # Use provided values, instance values, or error
        api_key = api_key or self.api_key
        model = model or self.model
        if not api_key:
            raise Exception("OpenAI API key is missing")

        try:
            files: dict = {"file": open(input_path, "rb")}
            data: dict = {
                "model": model,
                "chunking_strategy": "auto",
                "response_format": "diarized_json",
            }

            response = self.network.request(
                {
                    "url": "/v1/audio/transcriptions",
                    "method": "POST",
                    "headers": {"Authorization": f"Bearer {api_key}"},
                    "data": data,
                    "files": files,
                    "use_json": True,
                }
            )

            parsed_output = self._parse_transcription(response["data"])

            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(parsed_output, f, indent=2, ensure_ascii=False)

            return output_path
        except Exception as e:
            raise Exception(f"OpenAI transcription failed: {str(e)}")

    def _parse_transcription(self, raw_output: Dict[str, Any]) -> TranscriptionOutput:
        segments_data = raw_output.get("segments", [])
        unique_speakers = list(
            set(seg.get("speaker") for seg in segments_data if seg.get("speaker"))
        )

        segments: List[TranscriptionSegment] = []
        for segment in segments_data:
            segments.append(
                {
                    "from": float(segment.get("start", 0)),
                    "to": float(segment.get("end", 0)),
                    "text": segment.get("text", ""),
                    "speaker": segment.get("speaker") or None,
                }
            )

        # If duration is not found, use the "to" property from the last segment
        duration = raw_output.get("duration")
        if not duration and len(segments) > 0:
            duration = segments[-1]["to"] or 0.0

        return {
            "duration": float(duration) if duration else 0.0,
            "speakers": unique_speakers,
            "speaker_count": len(unique_speakers),
            "segments": segments,
            "metadata": {"tool": self.tool_name},
        }
