import json
import os
import re
import time
from typing import Any, Optional, TypedDict

from bridges.python.src.sdk.base_tool import (
    BaseTool,
    ExecuteCommandOptions,
    ProgressCallback,
)
from bridges.python.src.sdk.toolkit_config import ToolkitConfig

DEFAULT_SETTINGS = {}
REQUIRED_SETTINGS = []
DOWNLOAD_DESTINATION_PATTERN = re.compile(r"Destination:\s+(.+)$")
ALREADY_DOWNLOADED_PATTERN = re.compile(
    r"\[download\]\s+(.+)\s+has already been downloaded"
)
MERGED_FILE_PATTERN = re.compile(r'\[Merger\]\s+Merging formats into\s+"(.+)"$')
SUBTITLE_DESTINATION_PATTERN = re.compile(
    r"Writing (?:video subtitles|video automatic captions) to:\s+(.+)$"
)
DOWNLOAD_PROGRESS_PATTERN = re.compile(
    r"\[download\]\s+(\d+\.?\d*)%\s+of\s+(?:~?\s*)([\d.]+\w+)\s+at\s+([\d.]+\w+/s)\s+ETA\s+([\d:]+)"
)
YTDLP_EXT_TEMPLATE = "%(ext)s"
YTDLP_TITLE_TEMPLATE = "%(title)s"
YTDLP_PLAYLIST_INDEX_TEMPLATE = "%(playlist_index)s"
SUBTITLE_FORMAT = "srt/best"
SUBTITLE_CONVERT_FORMAT = "srt"
IGNORED_MEDIA_OUTPUT_EXTENSIONS = {
    ".part",
    ".ytdl",
    ".tmp",
    ".temp",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".json",
}
LANGUAGE_CODE_SEPARATOR = ","
SUBTITLE_OUTPUT_TYPE = "subtitle"
TYPED_OUTPUT_SEPARATOR = ":"
SUBTITLE_METADATA_LANGUAGE_FIELDS = [
    "language",
    "language_code",
    "original_language",
]
IGNORED_SUBTITLE_LANGUAGE_CODES = {"live_chat"}


class OutputTarget(TypedDict, total=False):
    directory_path: str
    output_template: str
    predicted_file_path: str


class VideoMetadata(TypedDict, total=False):
    language: Any
    language_code: Any
    original_language: Any
    subtitles: Any
    automatic_captions: Any


class YtdlpTool(BaseTool):
    TOOLKIT = "video_streaming"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

    @property
    def tool_name(self) -> str:
        return "ytdlp"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def _get_config_args(self):
        config_path = os.path.join(self._get_tool_dir(__file__), "yt-dlp.conf")
        return ["--config-locations", config_path]

    @staticmethod
    def _resolve_media_output_target(
        output_path: str, expected_extension: Optional[str] = None
    ) -> OutputTarget:
        """
        Resolve media output using yt-dlp filename templates.
        """
        extension = os.path.splitext(output_path)[1]
        looks_like_file = extension != ""
        existing_file_like_directory = (
            looks_like_file
            and os.path.exists(output_path)
            and os.path.isdir(output_path)
        )

        if not looks_like_file:
            return {
                "directory_path": output_path,
                "output_template": os.path.join(
                    output_path, f"{YTDLP_TITLE_TEMPLATE}.{YTDLP_EXT_TEMPLATE}"
                ),
            }

        stem = os.path.splitext(os.path.basename(output_path))[0]
        directory_path = (
            output_path
            if existing_file_like_directory
            else os.path.dirname(output_path) or "."
        )
        output_template = os.path.join(directory_path, f"{stem}.{YTDLP_EXT_TEMPLATE}")
        predicted_file_path = (
            os.path.join(directory_path, f"{stem}.{expected_extension}")
            if expected_extension
            else None
        )

        target: OutputTarget = {
            "directory_path": directory_path,
            "output_template": output_template,
        }
        if predicted_file_path:
            target["predicted_file_path"] = predicted_file_path

        return target

    @classmethod
    def _resolve_subtitle_output_target(
        cls, output_path: str, language_code: str
    ) -> OutputTarget:
        """
        Resolve subtitle output using yt-dlp's typed output template.
        """
        extension = os.path.splitext(output_path)[1]
        looks_like_file = extension != ""
        primary_language_code = cls._get_primary_language_code(language_code)
        existing_file_like_directory = (
            looks_like_file
            and os.path.exists(output_path)
            and os.path.isdir(output_path)
        )

        if not looks_like_file:
            return {
                "directory_path": output_path,
                "output_template": os.path.join(
                    output_path, f"{YTDLP_TITLE_TEMPLATE}.{YTDLP_EXT_TEMPLATE}"
                ),
            }

        requested_stem = os.path.splitext(os.path.basename(output_path))[0]
        stem = cls._strip_subtitle_language_suffix(
            requested_stem, primary_language_code
        )
        directory_path = (
            output_path
            if existing_file_like_directory
            else os.path.dirname(output_path) or "."
        )

        return {
            "directory_path": directory_path,
            "output_template": os.path.join(
                directory_path, f"{stem}.{YTDLP_EXT_TEMPLATE}"
            ),
            "predicted_file_path": os.path.join(
                directory_path,
                f"{stem}.{primary_language_code}.{SUBTITLE_CONVERT_FORMAT}",
            ),
        }

    @staticmethod
    def _get_primary_language_code(language_code: str) -> str:
        """
        Return the first language code when yt-dlp receives a language list.
        """
        return (
            language_code.split(LANGUAGE_CODE_SEPARATOR)[0].strip()
            or language_code
        )

    @staticmethod
    def _strip_subtitle_language_suffix(stem: str, language_code: str) -> str:
        """
        Remove a trailing subtitle language suffix from a requested file stem.
        """
        suffix = f".{language_code}"
        return stem[: -len(suffix)] if stem.endswith(suffix) else stem

    @staticmethod
    def _build_typed_output_template(type_name: str, template: str) -> str:
        """
        Build a typed yt-dlp output template, e.g. "subtitle:path.%(ext)s".
        """
        return f"{type_name}{TYPED_OUTPUT_SEPARATOR}{template}"

    @staticmethod
    def _parse_output_file_path(output: str) -> Optional[str]:
        """
        Parse file paths reported by yt-dlp.
        """
        parsed_path = None

        for line in output.split("\n"):
            match = (
                DOWNLOAD_DESTINATION_PATTERN.search(line)
                or ALREADY_DOWNLOADED_PATTERN.search(line)
                or MERGED_FILE_PATTERN.search(line)
                or SUBTITLE_DESTINATION_PATTERN.search(line)
            )
            if match and match.group(1):
                parsed_path = match.group(1).strip()

        return parsed_path

    @staticmethod
    def _get_metadata_language_codes(value: Any) -> list[str]:
        """
        Return language codes from a yt-dlp subtitle metadata object.
        """
        if not isinstance(value, dict):
            return []

        return [
            language_code
            for language_code in (str(key).strip() for key in value.keys())
            if language_code and language_code not in IGNORED_SUBTITLE_LANGUAGE_CODES
        ]

    @staticmethod
    def _get_video_language_candidates(metadata: VideoMetadata) -> list[str]:
        """
        Return language hints exposed by yt-dlp video metadata.
        """
        language_codes = [
            str(metadata[field]).strip()
            for field in SUBTITLE_METADATA_LANGUAGE_FIELDS
            if isinstance(metadata.get(field), str)
        ]

        return list(dict.fromkeys(filter(None, language_codes)))

    @staticmethod
    def _select_matching_language(
        requested_language_code: str,
        available_language_codes: list[str],
    ) -> Optional[str]:
        """
        Match exact language codes and simple regional variants.
        """
        normalized_requested = requested_language_code.strip().lower()
        if not normalized_requested:
            return None

        for language_code in available_language_codes:
            normalized_language_code = language_code.lower()
            if (
                normalized_language_code == normalized_requested
                or normalized_language_code.startswith(f"{normalized_requested}-")
                or normalized_requested.startswith(f"{normalized_language_code}-")
            ):
                return language_code

        return None

    @classmethod
    def _select_subtitle_language(
        cls,
        metadata: VideoMetadata,
        requested_language_code: Optional[str] = None,
    ) -> str:
        """
        Select the best available subtitle language.
        """
        subtitle_language_codes = cls._get_metadata_language_codes(
            metadata.get("subtitles")
        )
        automatic_caption_language_codes = cls._get_metadata_language_codes(
            metadata.get("automatic_captions")
        )
        requested = requested_language_code.strip() if requested_language_code else ""

        if requested:
            return (
                cls._select_matching_language(requested, subtitle_language_codes)
                or cls._select_matching_language(
                    requested, automatic_caption_language_codes
                )
                or requested
            )

        for language_code in cls._get_video_language_candidates(metadata):
            matching_language_code = cls._select_matching_language(
                language_code, subtitle_language_codes
            ) or cls._select_matching_language(
                language_code, automatic_caption_language_codes
            )

            if matching_language_code:
                return matching_language_code

        if subtitle_language_codes:
            return subtitle_language_codes[0]

        if automatic_caption_language_codes:
            return automatic_caption_language_codes[0]

        raise Exception("No subtitles or automatic captions are available for this video.")

    @staticmethod
    def _find_newest_output_file(
        directory_path: str, started_at_ms: Optional[float] = None
    ) -> Optional[str]:
        """
        Find the newest file created or updated in the output directory.
        """
        if not os.path.isdir(directory_path):
            return None

        min_modified_time = ((started_at_ms - 2000) / 1000) if started_at_ms else 0
        newest_path = None
        newest_modified_time = 0.0

        for entry_name in os.listdir(directory_path):
            candidate_path = os.path.join(directory_path, entry_name)
            if not os.path.isfile(candidate_path):
                continue
            if os.path.splitext(candidate_path)[1] in IGNORED_MEDIA_OUTPUT_EXTENSIONS:
                continue

            modified_time = os.path.getmtime(candidate_path)
            if modified_time < min_modified_time:
                continue

            if modified_time >= newest_modified_time:
                newest_path = candidate_path
                newest_modified_time = modified_time

        return newest_path

    @classmethod
    def _resolve_downloaded_media_path(
        cls,
        output: str,
        target: OutputTarget,
        started_at_ms: Optional[float] = None,
    ) -> str:
        """
        Resolve a media path from yt-dlp output or a deterministic file target.
        """
        predicted_file_path = target.get("predicted_file_path")
        if predicted_file_path and os.path.exists(predicted_file_path):
            return predicted_file_path

        parsed_path = cls._parse_output_file_path(output)
        if parsed_path and os.path.exists(parsed_path):
            return parsed_path

        newest_output_file = cls._find_newest_output_file(
            target["directory_path"], started_at_ms
        )
        if newest_output_file:
            return newest_output_file

        if parsed_path:
            return parsed_path

        raise Exception("yt-dlp completed but no output file path could be resolved")

    @classmethod
    def _resolve_downloaded_subtitle_path(
        cls, output: str, target: OutputTarget
    ) -> str:
        """
        Resolve a subtitle path and ensure a subtitle file was created.
        """
        parsed_path = cls._parse_output_file_path(output)

        for candidate in [target.get("predicted_file_path"), parsed_path]:
            if candidate and os.path.isfile(candidate):
                return candidate

        raise Exception("yt-dlp completed but no subtitle file was created")

    def _get_video_metadata(self, video_url: str) -> VideoMetadata:
        """
        Load video metadata to select the best available subtitle language.
        """
        args = self._get_config_args() + [
            video_url,
            "--dump-single-json",
            "--skip-download",
        ]
        output = self.execute_command(
            ExecuteCommandOptions(
                binary_name="yt-dlp", args=args, options={"sync": True}
            )
        )

        return json.loads(output.strip())

    def download_video(self, video_url: str, output_path: str) -> str:
        """
        Downloads a single video from the provided URL.

        Args:
            video_url: The URL of the video to download
            output_path: The directory or file path where the video will be saved

        Returns:
            The file path of the downloaded video
        """
        try:
            target = self._resolve_media_output_target(output_path)
            os.makedirs(target["directory_path"], exist_ok=True)
            command_started_at_ms = time.time() * 1000

            args = self._get_config_args() + [
                video_url,
                "-o",
                target["output_template"],
            ]
            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp", args=args, options={"sync": True}
                )
            )

            return self._resolve_downloaded_media_path(
                result, target, command_started_at_ms
            )

        except Exception as e:
            raise Exception(f"Video download failed: {str(e)}")

    def download_audio_only(
        self, video_url: str, output_path: str, audio_format: str
    ) -> str:
        """
        Downloads the audio track from a video and saves it as an audio file.

        Args:
            video_url: The URL of the video.
            output_path: The directory or file path where the audio will be saved.
            audio_format: The desired audio format (e.g., 'mp3', 'm4a', 'wav').

        Returns:
            The file path of the extracted audio.
        """
        try:
            target = self._resolve_media_output_target(output_path, audio_format)
            os.makedirs(target["directory_path"], exist_ok=True)
            command_started_at_ms = time.time() * 1000

            args = self._get_config_args() + [
                video_url,
                "-x",
                "--audio-format",
                audio_format,
                "-o",
                target["output_template"],
            ]

            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp", args=args, options={"sync": True}
                )
            )

            return self._resolve_downloaded_media_path(
                result, target, command_started_at_ms
            )

        except Exception as e:
            raise Exception(f"Audio download failed: {str(e)}")

    def download_playlist(self, playlist_url: str, output_path: str) -> str:
        """
        Downloads all videos from a given playlist URL.

        Args:
            playlist_url: The URL of the playlist.
            output_path: The directory where the playlist videos will be saved.

        Returns:
            The path to the directory containing the downloaded videos.
        """
        try:
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(
                output_path,
                f"{YTDLP_PLAYLIST_INDEX_TEMPLATE} - {YTDLP_TITLE_TEMPLATE}.{YTDLP_EXT_TEMPLATE}",
            )
            args = self._get_config_args() + [playlist_url, "-o", output_template]

            self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp", args=args, options={"sync": True}
                )
            )

            return output_path

        except Exception as e:
            raise Exception(f"Playlist download failed: {str(e)}")

    def download_video_by_quality(
        self,
        video_url: str,
        output_path: str,
        quality: str,
        on_progress: Optional[ProgressCallback] = None,
    ) -> str:
        """
        Downloads a video in a specific quality or resolution.

        Args:
            video_url: The URL of the video to download.
            output_path: The directory or file path where the video will be saved.
            quality: The desired quality string (e.g., 'best', '720p', '1080p').
            on_progress: The callback function for progress reporting.

        Returns:
            The file path of the downloaded video.
        """
        try:
            if quality == "best":
                format_selector = "best"
            elif quality == "worst":
                format_selector = "worst"
            elif quality.endswith("p"):
                # For resolution like 720p, 1080p.
                height = quality[:-1]
                format_selector = f"best[height<={height}]"
            else:
                format_selector = quality

            target = self._resolve_media_output_target(output_path)
            os.makedirs(target["directory_path"], exist_ok=True)
            command_started_at_ms = time.time() * 1000
            downloaded_file_path = ""

            def handle_output(output: str, is_error: bool):
                nonlocal downloaded_file_path

                for line in output.split("\n"):
                    if not is_error and "[download]" in line:
                        progress_match = DOWNLOAD_PROGRESS_PATTERN.search(line)
                        if progress_match and on_progress:
                            on_progress(
                                {
                                    "percentage": float(progress_match.group(1)),
                                    "size": progress_match.group(2),
                                    "speed": progress_match.group(3),
                                    "eta": progress_match.group(4),
                                    "status": "downloading",
                                }
                            )

                    path_match = self._parse_output_file_path(line)
                    if path_match:
                        downloaded_file_path = path_match

                    if not is_error and "[download] 100%" in line and on_progress:
                        on_progress({"percentage": 100, "status": "completed"})

            args = self._get_config_args() + [
                video_url,
                "-f",
                format_selector,
                "-o",
                target["output_template"],
                "--newline",
            ]
            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp",
                    args=args,
                    options={"sync": False},
                    on_progress=on_progress,
                    on_output=handle_output,
                )
            )

            return self._resolve_downloaded_media_path(
                "\n".join([downloaded_file_path, result]),
                target,
                command_started_at_ms,
            )

        except Exception as e:
            raise Exception(f"Quality-specific video download failed: {str(e)}")

    def download_subtitles(
        self,
        video_url: str,
        output_path: str,
        language_code: Optional[str] = None,
    ) -> str:
        """
        Downloads the subtitles for a video.

        Args:
            video_url: The URL of the video.
            output_path: The directory or file path where the subtitle will be saved.
            language_code: Optional language code for the desired subtitles (e.g., 'en', 'fr').

        Returns:
            The file path of the downloaded subtitle file.
        """
        try:
            resolved_language_code = self._select_subtitle_language(
                self._get_video_metadata(video_url), language_code
            )
            target = self._resolve_subtitle_output_target(
                output_path, resolved_language_code
            )
            os.makedirs(target["directory_path"], exist_ok=True)

            args = self._get_config_args() + [
                video_url,
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                resolved_language_code,
                "--sub-format",
                SUBTITLE_FORMAT,
                "--convert-subs",
                SUBTITLE_CONVERT_FORMAT,
                "--skip-download",
                "-o",
                self._build_typed_output_template(
                    SUBTITLE_OUTPUT_TYPE, target["output_template"]
                ),
            ]

            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp", args=args, options={"sync": True}
                )
            )

            return self._resolve_downloaded_subtitle_path(result, target)

        except Exception as e:
            raise Exception(f"Subtitle download failed: {str(e)}")

    def download_video_with_thumbnail(self, video_url: str, output_path: str) -> str:
        """
        Downloads a video and embeds its thumbnail as cover art.

        Args:
            video_url: The URL of the video.
            output_path: The directory or file path where the video will be saved.

        Returns:
            The file path of the video with the embedded thumbnail.
        """
        try:
            target = self._resolve_media_output_target(output_path)
            os.makedirs(target["directory_path"], exist_ok=True)
            command_started_at_ms = time.time() * 1000

            args = self._get_config_args() + [
                video_url,
                "--embed-thumbnail",
                "--write-thumbnail",
                "-o",
                target["output_template"],
            ]

            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="yt-dlp", args=args, options={"sync": True}
                )
            )

            return self._resolve_downloaded_media_path(
                result, target, command_started_at_ms
            )

        except Exception as e:
            raise Exception(f"Video download with thumbnail failed: {str(e)}")
