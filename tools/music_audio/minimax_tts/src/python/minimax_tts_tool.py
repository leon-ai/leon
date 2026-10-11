import binascii
import re
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network

# Hardcoded default settings for MiniMax TTS tool
MINIMAX_TTS_API_KEY = None
MINIMAX_TTS_MODEL = "speech-2.8-hd"
MINIMAX_TTS_REGION = "global_en"
DEFAULT_SETTINGS = {
    "MINIMAX_TTS_API_KEY": MINIMAX_TTS_API_KEY,
    "MINIMAX_TTS_MODEL": MINIMAX_TTS_MODEL,
    "MINIMAX_TTS_REGION": MINIMAX_TTS_REGION,
}
REQUIRED_SETTINGS = ["MINIMAX_TTS_API_KEY"]

# Text-to-audio endpoint per region. The global endpoint is served from the
# international host, the Chinese one from the mainland host.
TEXT_TO_AUDIO_ENDPOINTS = {
    "global_en": "https://api.minimax.io/v1/t2a_v2",
    "cn_zh": "https://api.minimaxi.com/v1/t2a_v2",
}

# Speech models accepted by the text-to-audio endpoint
SUPPORTED_MODELS = [
    "speech-2.8-hd",
    "speech-2.8-turbo",
    "speech-2.6-hd",
    "speech-2.6-turbo",
    "speech-02-hd",
    "speech-02-turbo",
    "speech-01-hd",
    "speech-01-turbo",
]

# Audio container formats the endpoint can encode
SUPPORTED_AUDIO_FORMATS = ["mp3", "wav", "flac", "pcm"]

# The endpoint reports success with this status code
SUCCESS_STATUS_CODE = 0

HEX_PATTERN = re.compile(r"^[0-9a-fA-F]+$")


class MiniMaxTTSTool(BaseTool):
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
        self.api_key = self.settings.get("MINIMAX_TTS_API_KEY", MINIMAX_TTS_API_KEY)
        self.model = self.settings.get("MINIMAX_TTS_MODEL", MINIMAX_TTS_MODEL)
        self.region = self.settings.get("MINIMAX_TTS_REGION", MINIMAX_TTS_REGION)

    @property
    def tool_name(self) -> str:
        # Use the actual config name for toolkit lookup
        return "minimax_tts"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def synthesize_to_file(
        self,
        text: str,
        output_path: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Synthesize speech from text and save the generated audio to a file

        Args:
            text: Text to synthesize into speech
            output_path: Path of the audio file to write
            options: Optional synthesis settings, defaulting to the tool settings

        Returns:
            The path to the generated audio file
        """
        options = options or {}

        if not text:
            raise Exception("Text to synthesize is missing")
        if not output_path:
            raise Exception("Output path is missing")

        api_key = options.get("apiKey") or self.api_key
        if not api_key:
            raise Exception("MiniMax API key is missing")

        model = options.get("model") or self.model
        if model not in SUPPORTED_MODELS:
            raise Exception(
                f"Unsupported speech model \"{model}\". "
                f"Supported models: {', '.join(SUPPORTED_MODELS)}"
            )

        region = options.get("region") or self.region
        if region not in TEXT_TO_AUDIO_ENDPOINTS:
            raise Exception(
                f"Unsupported region \"{region}\". "
                f"Supported regions: {', '.join(TEXT_TO_AUDIO_ENDPOINTS)}"
            )

        audio_setting = options.get("audioSetting")
        audio_format = audio_setting.get("format") if audio_setting else None
        if audio_format and audio_format not in SUPPORTED_AUDIO_FORMATS:
            raise Exception(
                f"Unsupported audio format \"{audio_format}\". "
                f"Supported formats: {', '.join(SUPPORTED_AUDIO_FORMATS)}"
            )

        output_format = options.get("outputFormat") or "hex"
        endpoint = urlparse(TEXT_TO_AUDIO_ENDPOINTS[region])
        network = Network({"base_url": f"{endpoint.scheme}://{endpoint.netloc}"})
        response = network.request(
            {
                "url": endpoint.path,
                "method": "POST",
                "headers": {
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                "data": self._build_request(text, model, output_format, options),
                "use_json": True,
            }
        )

        body = response["data"] or {}
        base_resp = body.get("base_resp") or {}
        status_code = base_resp.get("status_code")
        if status_code is not None and status_code != SUCCESS_STATUS_CODE:
            status_message = base_resp.get("status_msg") or "Unknown error"

            raise Exception(
                f"MiniMax speech synthesis failed with status {status_code}: "
                f"{status_message}"
            )

        audio = (body.get("data") or {}).get("audio")
        if not audio:
            raise Exception("MiniMax speech synthesis returned no audio")

        if output_format == "url":
            audio_bytes = self._download_audio(audio)
        else:
            audio_bytes = self._decode_audio(audio)

        with open(output_path, "wb") as audio_file:
            audio_file.write(audio_bytes)

        return output_path

    def _build_request(
        self,
        text: str,
        model: str,
        output_format: str,
        options: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Build the request body, omitting the options that were not provided."""
        request: Dict[str, Any] = {
            "model": model,
            "text": text,
            # The whole audio is needed at once to write it to a file
            "stream": False,
            "output_format": output_format,
        }

        if options.get("languageBoost"):
            request["language_boost"] = options["languageBoost"]
        if options.get("subtitleEnable") is not None:
            request["subtitle_enable"] = options["subtitleEnable"]
        if options.get("voiceSetting"):
            request["voice_setting"] = options["voiceSetting"]
        if options.get("audioSetting"):
            request["audio_setting"] = options["audioSetting"]
        if options.get("pronunciationDict"):
            request["pronunciation_dict"] = options["pronunciationDict"]
        if options.get("voiceModify"):
            request["voice_modify"] = options["voiceModify"]

        return request

    def _decode_audio(self, audio: str) -> bytes:
        """Decode the hexadecimal audio payload returned by the endpoint."""
        if len(audio) % 2 != 0 or not HEX_PATTERN.match(audio):
            raise Exception("MiniMax speech synthesis returned a malformed audio")

        return binascii.unhexlify(audio)

    def _download_audio(self, audio_url: str) -> bytes:
        """Download the audio when the endpoint returns a URL instead of bytes."""
        url = urlparse(audio_url)
        network = Network({"base_url": f"{url.scheme}://{url.netloc}"})
        path = url.path
        if url.query:
            path = f"{path}?{url.query}"

        response = network.request(
            {
                "url": path,
                "method": "GET",
                "response_type": "bytes",
            }
        )

        return response["data"]
