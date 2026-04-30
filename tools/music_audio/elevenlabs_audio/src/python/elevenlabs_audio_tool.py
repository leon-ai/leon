import json
from typing import List, Dict, Any, Optional

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network
from tools.music_audio.transcription_schema import TranscriptionOutput, TranscriptionSegment

# Hardcoded default settings for ElevenLabs audio tool
ELEVENLABS_AUDIO_API_KEY = None
ELEVENLABS_AUDIO_MODEL = "scribe_v1"
DEFAULT_SETTINGS = {
    "ELEVENLABS_AUDIO_API_KEY": ELEVENLABS_AUDIO_API_KEY,
    "ELEVENLABS_AUDIO_MODEL": ELEVENLABS_AUDIO_MODEL,
}
REQUIRED_SETTINGS = ["ELEVENLABS_AUDIO_API_KEY"]


class ElevenLabsAudioTool(BaseTool):
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
        self.api_key = self.settings.get(
            "ELEVENLABS_AUDIO_API_KEY", ELEVENLABS_AUDIO_API_KEY
        )
        self.model = self.settings.get("ELEVENLABS_AUDIO_MODEL", ELEVENLABS_AUDIO_MODEL)

        self.network = Network({"base_url": "https://api.elevenlabs.io"})

    @property
    def tool_name(self) -> str:
        return "elevenlabs_audio"

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
        diarize: bool = True,
    ) -> str:
        """
        Transcribe audio to a file using ElevenLabs' Scribe v1 API

        Args:
            input_path: Path to the audio file to transcribe
            output_path: Path to save the JSON transcription (unified format)
            api_key: ElevenLabs API key (uses env/hardcoded default if not provided)
            model: Transcription model (defaults to tool default)
            diarize: Whether to enable speaker diarization (defaults to True)

        Returns:
            The path to the transcription file
        """
        # Use provided values, instance values, or error
        api_key = api_key or self.api_key
        model = model or self.model
        if not api_key:
            raise Exception("ElevenLabs API key is missing")

        try:
            files: dict = {"file": open(input_path, "rb")}
            data: dict = {
                "model_id": model,
                "diarize": str(diarize).lower(),
                "tag_audio_events": "true",
                "timestamps_granularity": "word",
            }

            response = self.network.request(
                {
                    "url": "/v1/speech-to-text",
                    "method": "POST",
                    "headers": {"xi-api-key": api_key},
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
            raise Exception(f"ElevenLabs transcription failed: {str(e)}")

    def _parse_transcription(self, raw_output: Dict[str, Any]) -> TranscriptionOutput:
        """
        Parse ElevenLabs transcription response into unified schema format

        Args:
            raw_output: Raw response from ElevenLabs API

        Returns:
            Parsed transcription in unified format
        """
        words_data = raw_output.get("words", [])
        word_items = [word for word in words_data if word.get("type") == "word"]

        unique_speakers = list(
            set(word.get("speaker_id") for word in word_items if word.get("speaker_id"))
        )

        # Calculate duration from the last word's end time
        duration = float(word_items[-1].get("end", 0)) if word_items else 0.0

        segments: List[TranscriptionSegment] = []
        for word in word_items:
            segments.append(
                {
                    "from": float(word.get("start", 0)),
                    "to": float(word.get("end", 0)),
                    "text": word.get("text", ""),
                    "speaker": word.get("speaker_id") or None,
                }
            )

        return {
            "duration": duration,
            "speakers": unique_speakers,
            "speaker_count": len(unique_speakers),
            "segments": segments,
            "metadata": {"tool": self.tool_name},
        }
