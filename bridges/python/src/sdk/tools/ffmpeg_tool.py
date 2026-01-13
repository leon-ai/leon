from typing import List, Dict, Optional
from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig


class FfmpegTool(BaseTool):
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

    def _get_global_args(self) -> List[str]:
        """Get global FFmpeg arguments to hide banner and set log level to error"""
        return ['-hide_banner', '-loglevel', 'error']

    def convert_video_format(self, input_path: str, output_path: str) -> str:
        """
        Converts a video file to a different format.
        
        Args:
            input_path: The file path of the video to be converted.
            output_path: The desired file path for the converted video.
            
        Returns:
            The path to the converted video file.
        """
        try:
            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=self._get_global_args() + ['-i', input_path, output_path],
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Video conversion failed: {str(e)}")

    def extract_audio(self, video_path: str, audio_path: str) -> str:
        """
        Extracts the audio track from a video file and saves it as a separate audio file.
        
        Args:
            video_path: The file path of the video from which to extract audio.
            audio_path: The desired file path for the extracted audio.
            
        Returns:
            The path to the extracted audio file.
        """
        try:
            # Keep it simple: don't force codec/bitrate, let ffmpeg decide from extension.
            # Use -progress pipe:2 to stream progress to stderr and log it.
            args = self._get_global_args() + [
                '-y',
                '-i', video_path,
                '-vn',
                '-progress', 'pipe:2',
                audio_path
            ]

            def on_output(data: str, is_error: bool = False) -> None:
                if not is_error:
                    return
                for line in data.split('\n'):
                    line = line.strip()
                    if not line or '=' not in line:
                        continue
                    key, value = line.split('=', 1)
                    if key == 'progress':
                        self.log(f"ffmpeg progress: {value}")
                    elif key == 'out_time_ms':
                        try:
                            ms = int(value)
                            seconds = ms // 1_000_000
                            self.log(f"processed_time_seconds={seconds}")
                        except Exception:
                            pass
                    elif key == 'speed':
                        self.log(f"speed={value}")

            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=args,
                options={'sync': False},
                on_output=on_output
            ))

            return audio_path
        except Exception as e:
            raise Exception(f"Audio extraction failed: {str(e)}")

    def trim_media(self, input_path: str, output_path: str, start_time: str, end_time: str) -> str:
        """
        Trims a media (video or audio) file to a specified duration.
        
        Args:
            input_path: The file path of the media to be trimmed.
            output_path: The desired file path for the trimmed media.
            start_time: The start time for the trim, formatted as HH:MM:SS.
            end_time: The end time for the trim, formatted as HH:MM:SS.
            
        Returns:
            The path to the trimmed media file.
        """
        try:
            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=self._get_global_args() + ['-i', input_path, '-ss', start_time, '-to', end_time, '-c', 'copy', output_path],
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Video trimming failed: {str(e)}")

    def resize_video(self, input_path: str, output_path: str, width: int, height: int) -> str:
        """
        Resizes a video to the specified dimensions.
        
        Args:
            input_path: The file path of the video to be resized.
            output_path: The desired file path for the resized video.
            width: The target width of the video in pixels.
            height: The target height of the video in pixels.
            
        Returns:
            The path to the resized video file.
        """
        try:
            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=self._get_global_args() + ['-i', input_path, '-vf', f'scale={width}:{height}', output_path],
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Video resizing failed: {str(e)}")

    def combine_video_and_audio(self, video_path: str, audio_path: str, output_path: str) -> str:
        """
        Merges a video file with a separate audio file.
        
        Args:
            video_path: The file path of the video file.
            audio_path: The file path of the audio file.
            output_path: The desired file path for the combined video and audio.
            
        Returns:
            The path to the merged video file.
        """
        try:
            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=self._get_global_args() + ['-i', video_path, '-i', audio_path, '-c:v', 'copy', '-c:a', 'aac', '-strict', 'experimental',
                      output_path],
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Video and audio combination failed: {str(e)}")

    def compress_video(self, input_path: str, output_path: str, bitrate: str) -> str:
        """
        Compresses a video to reduce its file size.
        
        Args:
            input_path: The file path of the video to be compressed.
            output_path: The desired file path for the compressed video.
            bitrate: The target bitrate for the video (e.g., "1000k").
            
        Returns:
            The path to the compressed video file.
        """
        try:
            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=self._get_global_args() + ['-i', input_path, '-b:v', bitrate, output_path],
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Video compression failed: {str(e)}")

    def get_audio_duration(self, file_path: str) -> int:
        """
        Get the duration of an audio/video file in milliseconds using ffprobe.
        
        Args:
            file_path: The path to the audio or video file
            
        Returns:
            The duration in milliseconds
        """
        try:
            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ffprobe',
                args=self._get_global_args() + [
                    '-v', 'error',
                    '-show_format',
                    file_path
                ],
                options={'sync': True}
            ))
            
            # Parse the duration from stdout (format: duration=123.456)
            for line in result.split('\n'):
                line = line.strip()
                if line.startswith('duration='):
                    try:
                        duration_seconds = float(line.split('=')[1])
                        if duration_seconds > 0:
                            return round(duration_seconds * 1000)
                    except (ValueError, IndexError):
                        continue
            raise Exception('Could not parse duration from ffprobe output')
        except Exception as e:
            raise Exception(f"Failed to get audio duration: {str(e)}")

    def adjust_tempo(self, input_path: str, output_path: str, speed_factor: float, sample_rate: int = None) -> str:
        """
        Adjusts the tempo (speed) of an audio file using the atempo filter.
        If the speed factor is greater than 2.0, multiple atempo filters are chained.
        
        Args:
            input_path: The file path of the audio to be speed-adjusted.
            output_path: The desired file path for the speed-adjusted audio.
            speed_factor: The speed multiplier (e.g., 1.3 for 30% faster, 0.8 for 20% slower). Must be between 0.5 and 100.0.
            sample_rate: Optional sample rate for the output audio (defaults to the input's sample rate).
            
        Returns:
            The path to the speed-adjusted audio file.
        """
        try:
            if speed_factor < 0.5 or speed_factor > 100.0:
                raise ValueError('Speed factor must be between 0.5 and 100.0')

            # FFmpeg's atempo filter only supports values between 0.5 and 2.0
            # For larger speed factors, we need to chain multiple atempo filters
            atempo_filters = []
            remaining_speed = speed_factor

            while remaining_speed > 2.0:
                atempo_filters.append('atempo=2.0')
                remaining_speed /= 2.0

            if remaining_speed < 1.0 and remaining_speed < 0.5:
                while remaining_speed < 0.5:
                    atempo_filters.append('atempo=0.5')
                    remaining_speed /= 0.5

            atempo_filters.append(f'atempo={remaining_speed:.6f}')

            filter_complex = ','.join(atempo_filters)
            args = self._get_global_args() + ['-y', '-i', input_path, '-filter:a', filter_complex]

            if sample_rate:
                args.extend(['-ar', str(sample_rate)])

            args.append(output_path)

            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=args,
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Audio tempo adjustment failed: {str(e)}")

    def assemble_audio_segments(
        self,
        segments: List[Dict[str, any]],
        output_path: str,
        total_duration_ms: int,
        sample_rate: int = 22_050
    ) -> str:
        """
        Assembles multiple audio segments into a single audio file with precise timing.
        Each segment is placed at its exact timestamp with silence padding where needed.
        Similar to pydub's overlay functionality but using FFmpeg.
        
        Args:
            segments: List of dictionaries with 'path' (str) and 'start_ms' (int) keys
                     representing audio segments and their start times in milliseconds
            output_path: The desired file path for the assembled audio
            total_duration_ms: The total duration of the output audio in milliseconds
            sample_rate: Optional sample rate for the output audio (default: 22050)
            
        Returns:
            The path to the assembled audio file
        """
        try:
            if not segments:
                raise ValueError('No segments provided for assembly')

            # Build FFmpeg filter_complex for assembling segments at precise timestamps
            # We'll use the adelay filter to position each segment at its start time
            inputs = []
            filter_parts = []

            # Add all segment files as inputs
            for segment in segments:
                inputs.extend(['-i', segment['path']])

            # Build filter chain: adelay each segment, then amix them all together
            for i, segment in enumerate(segments):
                delay_ms = segment.get('start_ms', 0)
                # adelay takes delay in milliseconds
                filter_parts.append(f'[{i}:a]adelay={delay_ms}|{delay_ms}[a{i}]')

            # Mix all delayed streams together with normalization
            # Use amix with normalize=0 and weights=1 to prevent volume reduction
            mix_inputs = ''.join([f'[a{i}]' for i in range(len(segments))])
            filter_parts.append(f'{mix_inputs}amix=inputs={len(segments)}:duration=longest:dropout_transition=0:normalize=0[mixed]')

            # Apply dynamic normalization and compression to maintain consistent volume
            filter_parts.append('[mixed]dynaudnorm=f=150:g=15:p=0.9:s=5[normalized]')

            # Apply a slight compression to even out volume levels
            filter_parts.append('[normalized]acompressor=threshold=0.089:ratio=4:attack=20:release=250[aout]')

            filter_complex = ';'.join(filter_parts)

            # Calculate total duration in seconds for ffmpeg
            total_duration_s = total_duration_ms / 1000

            args = self._get_global_args() + [
                '-y',
                *inputs,
                '-filter_complex', filter_complex,
                '-map', '[aout]',
                '-ar', str(sample_rate),
                '-t', f'{total_duration_s:.3f}',
                '-c:a', 'pcm_s16le',
                output_path
            ]

            self.execute_command(ExecuteCommandOptions(
                binary_name='ffmpeg',
                args=args,
                options={'sync': True}
            ))

            return output_path
        except Exception as e:
            raise Exception(f"Audio assembly failed: {str(e)}")
