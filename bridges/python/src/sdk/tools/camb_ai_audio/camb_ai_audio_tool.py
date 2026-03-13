import json
import time
from typing import List, Dict, Any, Optional

from ...base_tool import BaseTool
from ...toolkit_config import ToolkitConfig
from ...network import Network
from ..transcription_schema import TranscriptionOutput, TranscriptionSegment

# Hardcoded default settings for CAMB AI audio tool
CAMB_AI_API_KEY = None
CAMB_AI_TTS_MODEL = "mars-flash"
CAMB_AI_DEFAULT_VOICE_ID = None
DEFAULT_SETTINGS = {
    "CAMB_AI_API_KEY": CAMB_AI_API_KEY,
    "CAMB_AI_TTS_MODEL": CAMB_AI_TTS_MODEL,
    "CAMB_AI_DEFAULT_VOICE_ID": CAMB_AI_DEFAULT_VOICE_ID,
}
REQUIRED_SETTINGS = ["CAMB_AI_API_KEY"]


class CambAIAudioTool(BaseTool):
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
        self.api_key = self.settings.get("CAMB_AI_API_KEY", CAMB_AI_API_KEY)
        self.tts_model = self.settings.get("CAMB_AI_TTS_MODEL", CAMB_AI_TTS_MODEL)
        self.default_voice_id = self.settings.get(
            "CAMB_AI_DEFAULT_VOICE_ID", CAMB_AI_DEFAULT_VOICE_ID
        )

        self.network = Network({"base_url": "https://client.camb.ai/apis"})

    @property
    def tool_name(self) -> str:
        return "camb_ai_audio"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def _get_headers(self, api_key: Optional[str] = None) -> Dict[str, str]:
        key = api_key or self.api_key
        if not key:
            raise Exception("CAMB AI API key is missing")
        return {"x-api-key": key}

    def _poll_task(
        self,
        status_endpoint: str,
        task_id: str,
        api_key: Optional[str] = None,
        timeout: int = 300,
        poll_interval: int = 5,
    ) -> Dict[str, Any]:
        """
        Poll an async task until completion.

        Args:
            status_endpoint: The endpoint path for status checks (e.g., '/transcribe')
            task_id: The task ID to poll
            api_key: Optional API key override
            timeout: Max seconds to wait
            poll_interval: Seconds between polls

        Returns:
            The final status response data
        """
        headers = self._get_headers(api_key)
        start_time = time.time()

        while time.time() - start_time < timeout:
            response = self.network.request(
                {
                    "url": f"{status_endpoint}/{task_id}",
                    "method": "GET",
                    "headers": headers,
                }
            )
            data = response["data"]
            status = data.get("status", "")

            if status == "SUCCESS":
                return data
            elif status in ("FAILED", "ERROR"):
                raise Exception(
                    f"CAMB AI task failed: {data.get('error', 'Unknown error')}"
                )

            time.sleep(poll_interval)

        raise Exception(f"CAMB AI task timed out after {timeout}s")

    def text_to_speech(
        self,
        text: str,
        output_path: str,
        language: int,
        voice_id: Optional[int] = None,
        api_key: Optional[str] = None,
        speech_model: Optional[str] = None,
    ) -> str:
        """
        Convert text to speech using CAMB AI's streaming TTS API.

        Args:
            text: The text to convert to speech
            output_path: Path to save the generated audio file
            language: CAMB AI language ID
            voice_id: Voice ID to use (uses default if not provided)
            api_key: Optional API key override
            speech_model: TTS model to use (defaults to tool default)

        Returns:
            The path to the saved audio file
        """
        headers = self._get_headers(api_key)
        voice_id = voice_id or self.default_voice_id
        speech_model = speech_model or self.tts_model

        payload: Dict[str, Any] = {
            "text": text,
            "language": language,
        }
        if voice_id is not None:
            payload["voice_id"] = voice_id
        if speech_model:
            payload["speech_model"] = speech_model

        try:
            response = self.network.request(
                {
                    "url": "/tts-stream",
                    "method": "POST",
                    "headers": {**headers, "content-type": "application/json"},
                    "data": payload,
                    "response_type": "bytes",
                }
            )

            with open(output_path, "wb") as f:
                f.write(response["data"])

            return output_path
        except Exception as e:
            raise Exception(f"CAMB AI TTS failed: {str(e)}")

    def translate(
        self,
        text: str,
        source_language: int,
        target_language: int,
        api_key: Optional[str] = None,
    ) -> str:
        """
        Translate text using CAMB AI's translation stream API.

        Args:
            text: The text to translate
            source_language: CAMB AI source language ID
            target_language: CAMB AI target language ID
            api_key: Optional API key override

        Returns:
            The translated text
        """
        headers = self._get_headers(api_key)

        try:
            response = self.network.request(
                {
                    "url": "/translation/stream",
                    "method": "POST",
                    "headers": {**headers, "content-type": "application/json"},
                    "data": {
                        "source_language": source_language,
                        "target_language": target_language,
                        "text": text,
                    },
                }
            )

            data = response["data"]
            # The translation stream endpoint may return the translated text
            # in different formats depending on the response
            if isinstance(data, dict):
                return data.get("translation", data.get("text", str(data)))
            return str(data)
        except Exception as e:
            raise Exception(f"CAMB AI translation failed: {str(e)}")

    def transcribe_to_file(
        self,
        input_path: str,
        output_path: str,
        language: int,
        api_key: Optional[str] = None,
    ) -> str:
        """
        Transcribe audio to a file using CAMB AI's transcription API.

        Args:
            input_path: Path to the audio file to transcribe
            output_path: Path to save the JSON transcription (unified format)
            language: CAMB AI language ID
            api_key: Optional API key override

        Returns:
            The path to the transcription file
        """
        headers = self._get_headers(api_key)

        try:
            # Submit transcription task
            files: dict = {"media_file": open(input_path, "rb")}
            data: dict = {"language": str(language)}

            response = self.network.request(
                {
                    "url": "/transcribe",
                    "method": "POST",
                    "headers": headers,
                    "data": data,
                    "files": files,
                    "use_json": False,
                }
            )

            task_id = response["data"].get("task_id")
            if not task_id:
                raise Exception("No task_id returned from transcription request")

            # Poll for completion
            result = self._poll_task("/transcribe", task_id, api_key)

            run_id = result.get("run_id")
            if not run_id:
                raise Exception("No run_id returned from completed transcription task")

            # Get the transcription result
            result_response = self.network.request(
                {
                    "url": f"/transcription-result/{run_id}",
                    "method": "GET",
                    "headers": headers,
                }
            )

            parsed_output = self._parse_transcription(result_response["data"])

            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(parsed_output, f, indent=2, ensure_ascii=False)

            return output_path
        except Exception as e:
            raise Exception(f"CAMB AI transcription failed: {str(e)}")

    def _parse_transcription(self, raw_output: Dict[str, Any]) -> TranscriptionOutput:
        """
        Parse CAMB AI transcription response into unified schema format.

        Args:
            raw_output: Raw response from CAMB AI API

        Returns:
            Parsed transcription in unified format
        """
        segments_data = raw_output.get("segments", [])
        duration = float(raw_output.get("duration", 0))

        unique_speakers: List[str] = []
        segments: List[TranscriptionSegment] = []

        for seg in segments_data:
            speaker = seg.get("speaker")
            if speaker and speaker not in unique_speakers:
                unique_speakers.append(speaker)

            segments.append(
                {
                    "from": float(seg.get("start", 0)),
                    "to": float(seg.get("end", 0)),
                    "text": seg.get("text", ""),
                    "speaker": speaker,
                }
            )

        # If no segments but we have a text field, create a single segment
        if not segments and raw_output.get("text"):
            segments.append(
                {
                    "from": 0.0,
                    "to": duration,
                    "text": raw_output["text"],
                    "speaker": None,
                }
            )

        return {
            "duration": duration,
            "speakers": unique_speakers,
            "speaker_count": len(unique_speakers),
            "segments": segments,
            "metadata": {"tool": self.tool_name},
        }

    def translated_tts(
        self,
        text: str,
        voice_id: int,
        source_language: int,
        target_language: int,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Translate text and generate speech in the target language.

        Args:
            text: The text to translate and speak
            voice_id: Voice ID for the output speech
            source_language: CAMB AI source language ID
            target_language: CAMB AI target language ID
            api_key: Optional API key override

        Returns:
            Task result containing run_id and status
        """
        headers = self._get_headers(api_key)

        try:
            response = self.network.request(
                {
                    "url": "/translated-tts",
                    "method": "POST",
                    "headers": {**headers, "content-type": "application/json"},
                    "data": {
                        "text": text,
                        "voice_id": voice_id,
                        "source_language": source_language,
                        "target_language": target_language,
                    },
                }
            )

            data = response["data"]
            task_id = data.get("task_id")

            if task_id:
                result = self._poll_task("/translated-tts", task_id, api_key)
                run_id = result.get("run_id")

                if run_id:
                    # Fetch the generated audio from the TTS result endpoint
                    audio_response = self.network.request(
                        {
                            "url": f"/tts-result/{run_id}",
                            "method": "GET",
                            "headers": headers,
                            "response_type": "bytes",
                        }
                    )
                    return {
                        "run_id": run_id,
                        "audio_data": audio_response["data"],
                    }

                return result

            return data
        except Exception as e:
            raise Exception(f"CAMB AI translated TTS failed: {str(e)}")

    def clone_voice(
        self,
        input_path: str,
        voice_name: str,
        gender: int,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Clone a voice from an audio sample.

        Args:
            input_path: Path to the audio sample for voice cloning
            voice_name: Name for the cloned voice
            gender: Gender of the voice (1=male, 2=female)
            api_key: Optional API key override

        Returns:
            The created voice data including voice ID
        """
        headers = self._get_headers(api_key)

        try:
            files: dict = {"file": open(input_path, "rb")}
            data: dict = {
                "voice_name": voice_name,
                "gender": str(gender),
            }

            response = self.network.request(
                {
                    "url": "/create-custom-voice",
                    "method": "POST",
                    "headers": headers,
                    "data": data,
                    "files": files,
                    "use_json": False,
                }
            )

            return response["data"]
        except Exception as e:
            raise Exception(f"CAMB AI voice cloning failed: {str(e)}")

    def list_voices(
        self,
        api_key: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        List all available voices.

        Args:
            api_key: Optional API key override

        Returns:
            List of available voices
        """
        headers = self._get_headers(api_key)

        try:
            response = self.network.request(
                {
                    "url": "/list-voices",
                    "method": "GET",
                    "headers": headers,
                }
            )

            return response["data"]
        except Exception as e:
            raise Exception(f"CAMB AI list voices failed: {str(e)}")

    def dub_media(
        self,
        video_url: str,
        source_language: int,
        target_language: int,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Dub a video or audio file into a target language.

        Args:
            video_url: URL of the video/audio to dub
            source_language: CAMB AI source language ID
            target_language: CAMB AI target language ID
            api_key: Optional API key override

        Returns:
            The dubbing result data
        """
        headers = self._get_headers(api_key)

        try:
            response = self.network.request(
                {
                    "url": "/dub",
                    "method": "POST",
                    "headers": {**headers, "content-type": "application/json"},
                    "data": {
                        "video_url": video_url,
                        "source_language": source_language,
                        "target_language": target_language,
                    },
                }
            )

            data = response["data"]
            task_id = data.get("task_id")

            if task_id:
                result = self._poll_task("/dub", task_id, api_key)
                run_id = result.get("run_id")

                if run_id:
                    # Get the dubbing result
                    result_response = self.network.request(
                        {
                            "url": f"/dub-result/{run_id}",
                            "method": "GET",
                            "headers": headers,
                        }
                    )
                    return result_response["data"]

                return result

            return data
        except Exception as e:
            raise Exception(f"CAMB AI dubbing failed: {str(e)}")

    def text_to_sound(
        self,
        prompt: str,
        duration: Optional[float] = None,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate music or sound effects from a text prompt.

        Args:
            prompt: Text description of the sound to generate
            duration: Desired duration of the audio in seconds
            api_key: Optional API key override

        Returns:
            The text-to-sound result data
        """
        headers = self._get_headers(api_key)

        payload: Dict[str, Any] = {"prompt": prompt}
        if duration is not None:
            payload["duration"] = duration

        try:
            response = self.network.request(
                {
                    "url": "/text-to-sound",
                    "method": "POST",
                    "headers": {**headers, "content-type": "application/json"},
                    "data": payload,
                }
            )

            data = response["data"]
            task_id = data.get("task_id")

            if task_id:
                result = self._poll_task("/text-to-sound", task_id, api_key)
                run_id = result.get("run_id")

                if run_id:
                    result_response = self.network.request(
                        {
                            "url": f"/text-to-sound-result/{run_id}",
                            "method": "GET",
                            "headers": headers,
                            "response_type": "bytes",
                        }
                    )
                    return {"run_id": run_id, "audio_data": result_response["data"]}

                return result

            return data
        except Exception as e:
            raise Exception(f"CAMB AI text-to-sound failed: {str(e)}")

    def separate_audio(
        self,
        input_path: str,
        api_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Separate vocals from instrumental audio.

        Args:
            input_path: Path to the audio file to separate
            api_key: Optional API key override

        Returns:
            The audio separation result data
        """
        headers = self._get_headers(api_key)

        try:
            files: dict = {"media_file": open(input_path, "rb")}

            response = self.network.request(
                {
                    "url": "/audio-separation",
                    "method": "POST",
                    "headers": headers,
                    "files": files,
                    "use_json": False,
                }
            )

            data = response["data"]
            task_id = data.get("task_id")

            if task_id:
                result = self._poll_task("/audio-separation", task_id, api_key)
                run_id = result.get("run_id")

                if run_id:
                    result_response = self.network.request(
                        {
                            "url": f"/audio-separation-result/{run_id}",
                            "method": "GET",
                            "headers": headers,
                        }
                    )
                    return result_response["data"]

                return result

            return data
        except Exception as e:
            raise Exception(f"CAMB AI audio separation failed: {str(e)}")
