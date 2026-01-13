import json
from typing import Dict, Any, List, Optional
from ..base_tool import BaseTool, ExecuteCommandOptions
from ..toolkit_config import ToolkitConfig


class MediaFormatInfo:
    def __init__(self, data: Dict[str, Any]):
        self.filename: str = data.get('filename', '')
        self.nb_streams: int = data.get('nb_streams', 0)
        self.format_name: str = data.get('format_name', '')
        self.format_long_name: str = data.get('format_long_name', '')
        self.start_time: str = data.get('start_time', '')
        self.duration: str = data.get('duration', '')
        self.size: str = data.get('size', '')
        self.bit_rate: str = data.get('bit_rate', '')
        self.probe_score: int = data.get('probe_score', 0)
        self.tags: Optional[Dict[str, str]] = data.get('tags')

    def to_dict(self) -> Dict[str, Any]:
        return {
            'filename': self.filename,
            'nb_streams': self.nb_streams,
            'format_name': self.format_name,
            'format_long_name': self.format_long_name,
            'start_time': self.start_time,
            'duration': self.duration,
            'size': self.size,
            'bit_rate': self.bit_rate,
            'probe_score': self.probe_score,
            'tags': self.tags
        }


class StreamInfo:
    def __init__(self, data: Dict[str, Any]):
        self.index: int = data.get('index', 0)
        self.codec_name: str = data.get('codec_name', '')
        self.codec_long_name: str = data.get('codec_long_name', '')
        self.codec_type: str = data.get('codec_type', '')
        self.width: Optional[int] = data.get('width')
        self.height: Optional[int] = data.get('height')
        self.r_frame_rate: Optional[str] = data.get('r_frame_rate')
        self.sample_rate: Optional[str] = data.get('sample_rate')
        self.channels: Optional[int] = data.get('channels')
        # Store all other properties
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data.get(key)

    def to_dict(self) -> Dict[str, Any]:
        return self._data


class FrameInfo:
    def __init__(self, data: Dict[str, Any]):
        self.media_type: str = data.get('media_type', '')
        self.stream_index: int = data.get('stream_index', 0)
        self.key_frame: int = data.get('key_frame', 0)
        self.pts: int = data.get('pts', 0)
        self.pts_time: str = data.get('pts_time', '')
        self.dts: int = data.get('dts', 0)
        self.dts_time: str = data.get('dts_time', '')
        self.duration: int = data.get('duration', 0)
        self.duration_time: str = data.get('duration_time', '')
        self.size: str = data.get('size', '')
        self.pos: str = data.get('pos', '')
        # Store all other properties
        self._data = data

    def __getitem__(self, key: str) -> Any:
        return self._data.get(key)

    def to_dict(self) -> Dict[str, Any]:
        return self._data


class FfprobeTool(BaseTool):
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

    def get_media_format_info(self, file_path: str) -> MediaFormatInfo:
        """
        Retrieves general format information about a media file.
        
        Args:
            file_path: The path to the input media file.
            
        Returns:
            The media's format information.
        """
        try:
            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ffprobe',
                args=['-hide_banner', '-v', 'quiet', '-print_format', 'json', '-show_format', file_path],
                options={'sync': True}
            ))

            data = json.loads(result)
            format_data = data.get('format', {})

            return MediaFormatInfo(format_data)

        except Exception as e:
            raise Exception(f"Failed to get media format info: {str(e)}")

    def list_streams(self, file_path: str) -> List[StreamInfo]:
        """
        Lists all streams contained within a media file.
        
        Args:
            file_path: The path to the input media file.
            
        Returns:
            An array of stream information objects.
        """
        try:
            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ffprobe',
                args=['-hide_banner', '-v', 'quiet', '-print_format', 'json', '-show_streams', file_path],
                options={'sync': True}
            ))

            data = json.loads(result)
            streams_data = data.get('streams', [])

            return [StreamInfo(stream_data) for stream_data in streams_data]

        except Exception as e:
            raise Exception(f"Failed to list streams: {str(e)}")

    def get_video_stream_info(self, file_path: str) -> List[StreamInfo]:
        """
        Retrieves detailed information for all video streams in a file.
        
        Args:
            file_path: The path to the input media file.
            
        Returns:
            An array of video stream information objects.
        """
        try:
            all_streams = self.list_streams(file_path)
            return [stream for stream in all_streams if stream.codec_type == 'video']

        except Exception as e:
            raise Exception(f"Failed to get video stream info: {str(e)}")

    def get_audio_stream_info(self, file_path: str) -> List[StreamInfo]:
        """
        Retrieves detailed information for all audio streams in a file.
        
        Args:
            file_path: The path to the input media file.
            
        Returns:
            An array of audio stream information objects.
        """
        try:
            all_streams = self.list_streams(file_path)
            return [stream for stream in all_streams if stream.codec_type == 'audio']

        except Exception as e:
            raise Exception(f"Failed to get audio stream info: {str(e)}")

    def count_frames(self, file_path: str) -> int:
        """
        Counts the total number of frames in the primary video stream of a file.
        
        Args:
            file_path: The path to the input video file.
            
        Returns:
            The total frame count.
        """
        try:
            try:
                # Try to get nb_frames first
                result = self.execute_command(ExecuteCommandOptions(
                    binary_name='ffprobe',
                    args=['-hide_banner', '-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_frames',
                          '-of', 'csv=p=0', file_path],
                    options={'sync': True}
                ))

                frame_count_str = result.strip()
                if frame_count_str and frame_count_str != 'N/A':
                    return int(frame_count_str)
            except:
                # Ignore error, fallback to manual counting
                pass

            # Fallback: count frames manually if nb_frames is not available
            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ffprobe',
                args=['-hide_banner', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=n', '-of', 'csv=p=0', file_path],
                options={'sync': True}
            ))

            lines = result.strip().split('\n')
            return len([line for line in lines if line.strip()])

        except Exception as e:
            raise Exception(f"Failed to count frames: {str(e)}")

    def get_frames_info(self, file_path: str) -> List[FrameInfo]:
        """
        Retrieves detailed, frame-by-frame information from a video stream.
        
        Args:
            file_path: The path to the input video file.
            
        Returns:
            An array of frame information objects.
        """
        try:
            result = self.execute_command(ExecuteCommandOptions(
                binary_name='ffprobe',
                args=['-hide_banner', '-v', 'quiet', '-print_format', 'json', '-show_frames', '-select_streams', 'v:0', file_path],
                options={'sync': True}
            ))

            data = json.loads(result)
            frames_data = data.get('frames', [])

            return [FrameInfo(frame_data) for frame_data in frames_data]

        except Exception as e:
            raise Exception(f"Failed to get frames info: {str(e)}")
