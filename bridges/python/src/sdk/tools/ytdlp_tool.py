import os
from typing import Optional
from ..base_tool import BaseTool, ExecuteCommandOptions, ProgressCallback
from ..toolkit_config import ToolkitConfig


class YtdlpTool(BaseTool):
    TOOLKIT = 'video_streaming'

    def __init__(self):
        super().__init__()
        # Load configuration from central toolkits directory
        # Use class name for tool config name
        tool_config_name = self.__class__.__name__.lower().replace('tool', '')
        self.config = ToolkitConfig.load(self.TOOLKIT, tool_config_name)

    @property
    def tool_name(self) -> str:
        # Dynamic tool name based on class name
        return self.__class__.__name__

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def _build_common_args(self):
        """Build common yt-dlp arguments with retry and sleep options"""
        return [
            '--retries', '3',
            '--sleep-interval', '0.5',
            '--max-sleep-interval', '2'
        ]

    def download_video(self, video_url: str, output_path: str) -> str:
        """
        Downloads a single video from the provided URL.
        
        Args:
            video_url: The URL of the video to download
            output_path: The directory where the video will be saved
            
        Returns:
            The file path of the downloaded video
        """
        try:
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(output_path, '%(title)s.%(ext)s')
            args = self._build_common_args() + [video_url, '-o', output_template]

            result = self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': True}
            ))

            # Parse the output to get the actual filename
            lines = result.split('\n')
            for line in lines:
                if ('has already been downloaded' in line or
                    'Destination:' in line):
                    filename = line.split(' ')[-1]
                    if filename:
                        return filename

            return output_template

        except Exception as e:
            raise Exception(f"Video download failed: {str(e)}")

    def download_audio_only(self, video_url: str, output_path: str, audio_format: str) -> str:
        """
        Downloads the audio track from a video and saves it as an audio file.
        
        Args:
            video_url: The URL of the video.
            output_path: The directory to save the audio file in.
            audio_format: The desired audio format (e.g., 'mp3', 'm4a', 'wav').
            
        Returns:
            The file path of the extracted audio.
        """
        try:
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(output_path, '%(title)s.%(ext)s')
            args = self._build_common_args() + [video_url, '-x', '--audio-format', audio_format, '-o', output_template]

            result = self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': True}
            ))

            # Parse the output to get the actual filename
            lines = result.split('\n')
            for line in lines:
                if ('has already been downloaded' in line or
                    'Destination:' in line):
                    filename = line.split(' ')[-1]
                    if filename:
                        return filename

            return output_template

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
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(output_path, '%(playlist_index)s - %(title)s.%(ext)s')
            args = self._build_common_args() + [playlist_url, '-o', output_template]

            self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': True}
            ))

            return output_path

        except Exception as e:
            raise Exception(f"Playlist download failed: {str(e)}")

    def download_video_by_quality(self, video_url: str, output_path: str, quality: str,
                                  on_progress: Optional[ProgressCallback] = None) -> str:
        """
        Downloads a video in a specific quality or resolution.
        
        Args:
            video_url: The URL of the video to download.
            output_path: The directory where the video will be saved.
            quality: The desired quality string (e.g., 'best', '720p', '1080p').
            on_progress: The callback function for progress reporting.
            
        Returns:
            The file path of the downloaded video.
        """
        try:
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            # Convert quality to yt-dlp format
            if quality == 'best':
                format_selector = 'best'
            elif quality == 'worst':
                format_selector = 'worst'
            elif quality.endswith('p'):
                # For resolution like 720p, 1080p
                height = quality[:-1]
                format_selector = f'best[height<={height}]'
            else:
                format_selector = quality

            output_template = os.path.join(output_path, '%(title)s.%(ext)s')
            downloaded_file_path = output_template

            def handle_output(output: str, is_error: bool):
                nonlocal downloaded_file_path
                if not is_error:
                    lines = output.split('\n')

                    for line in lines:
                        # Parse download progress
                        if '[download]' in line:
                            import re
                            progress_match = re.search(
                                r'\[download\]\s+(\d+\.?\d*)%\s+of\s+(?:~?\s*)([\d.]+\w+)\s+at\s+([\d.]+\w+/s)\s+ETA\s+([\d:]+)',
                                line
                            )
                            if progress_match and on_progress:
                                on_progress({
                                    'percentage': float(progress_match.group(1)),
                                    'size': progress_match.group(2),
                                    'speed': progress_match.group(3),
                                    'eta': progress_match.group(4),
                                    'status': 'downloading'
                                })

                        # Check for completed download or destination file
                        if '[download] Destination:' in line or 'has already been downloaded' in line:
                            import re
                            path_match = re.search(r'Destination:\s+(.+)$', line) or re.search(
                                r'(.+)\s+has already been downloaded', line)
                            if path_match:
                                downloaded_file_path = path_match.group(1).strip()

                        # Check for download completion
                        if '[download] 100%' in line and on_progress:
                            on_progress({
                                'percentage': 100,
                                'status': 'completed'
                            })

            args = self._build_common_args() + [video_url, '-f', format_selector, '-o', output_template]
            self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': False},
                on_progress=on_progress,
                on_output=handle_output
            ))

            return downloaded_file_path

        except Exception as e:
            raise Exception(f"Quality-specific video download failed: {str(e)}")

    def download_subtitles(self, video_url: str, output_path: str, language_code: str) -> str:
        """
        Downloads the subtitles for a video.
        
        Args:
            video_url: The URL of the video.
            output_path: The directory to save the subtitle file in.
            language_code: The language code for the desired subtitles (e.g., 'en', 'es').
            
        Returns:
            The file path of the downloaded subtitle file.
        """
        try:
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(output_path, '%(title)s.%(ext)s')
            args = self._build_common_args() + [video_url, '--write-subs', '--sub-langs', language_code,
                                                '--skip-download', '-o', output_template]

            self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': True}
            ))

            # The subtitle file will have the same name but with .srt extension
            subtitle_file = output_template.replace('.%(ext)s', f'.{language_code}.srt')
            return subtitle_file

        except Exception as e:
            raise Exception(f"Subtitle download failed: {str(e)}")

    def download_video_with_thumbnail(self, video_url: str, output_path: str) -> str:
        """
        Downloads a video and embeds its thumbnail as cover art.
        
        Args:
            video_url: The URL of the video.
            output_path: The directory where the video will be saved.
            
        Returns:
            The file path of the video with the embedded thumbnail.
        """
        try:
            # Ensure output directory exists
            os.makedirs(output_path, exist_ok=True)

            output_template = os.path.join(output_path, '%(title)s.%(ext)s')
            args = self._build_common_args() + [video_url, '--embed-thumbnail', '--write-thumbnail', '-o',
                                                output_template]

            result = self.execute_command(ExecuteCommandOptions(
                binary_name='yt-dlp',
                args=args,
                options={'sync': True}
            ))

            # Parse the output to get the actual filename
            lines = result.split('\n')
            for line in lines:
                if ('has already been downloaded' in line or
                    'Destination:' in line):
                    filename = line.split(' ')[-1]
                    if filename:
                        return filename

            return output_template

        except Exception as e:
            raise Exception(f"Video download with thumbnail failed: {str(e)}")
