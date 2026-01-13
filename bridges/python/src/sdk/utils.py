import platform
from typing import List
import urllib.request
import urllib.error
import math
from typing import Union

HUGGING_FACE_URL = 'https://huggingface.co'
HUGGING_FACE_MIRROR_URL = 'https://hf-mirror.com'


def can_access_hugging_face() -> bool:
    """Check if the current network can access Hugging Face
    
    Returns:
        True if Hugging Face is accessible, False otherwise
        
    Example:
        can_access_hugging_face() # returns True if accessible
    """
    try:
        req = urllib.request.Request(HUGGING_FACE_URL, method='HEAD')
        with urllib.request.urlopen(req, timeout=5) as response:
            return response.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, Exception):
        return False


def set_hugging_face_url(url: str) -> str:
    """Set the Hugging Face URL based on the network access
    
    Args:
        url: The URL to set
        
    Returns:
        The original URL if accessible, or the mirror URL if not accessible
        
    Example:
        set_hugging_face_url('https://huggingface.co') # returns 'https://hf-mirror.com' if not accessible
    """
    if 'huggingface.co' not in url:
        return url

    can_access = can_access_hugging_face()

    if not can_access:
        return url.replace(HUGGING_FACE_URL, HUGGING_FACE_MIRROR_URL)

    return url


def format_file_path(file_path: str) -> str:
    """Formats a file path as a clickable path with proper delimiters
    
    Args:
        file_path: The absolute file path to format
        
    Returns:
        A formatted string that the client can detect and make clickable
        
    Example:
        format_file_path('/Users/john/video.mp4') # returns '[FILE_PATH]/Users/john/video.mp4[/FILE_PATH]'
    """
    return f"[FILE_PATH]{file_path}[/FILE_PATH]"


def format_file_paths(file_paths: List[str]) -> str:
    """Formats multiple file paths as a list of clickable paths
    
    Args:
        file_paths: List of absolute file paths
        
    Returns:
        A formatted string with multiple clickable paths
        
    Example:
        format_file_paths(['/path1', '/path2']) # returns '[FILE_PATH]/path1[/FILE_PATH], [FILE_PATH]/path2[/FILE_PATH]'
    """
    return ', '.join(format_file_path(path) for path in file_paths)


def get_platform_name() -> str:
    """Get platform name with architecture granularity (matches system-helper.ts)
    
    Returns:
        Platform name string (e.g., 'linux-x86_64', 'macosx-arm64', 'win-amd64')
        
    Example:
        get_platform_name() # returns 'macosx-arm64' on Apple Silicon Mac
    """
    system = platform.system().lower()
    architecture = platform.machine().lower()

    if system == 'linux':
        if architecture in ['x86_64', 'amd64']:
            return 'linux-x86_64'
        elif architecture in ['aarch64', 'arm64']:
            return 'linux-aarch64'
        else:
            # Default to x86_64 for unknown architectures on Linux
            return 'linux-x86_64'

    elif system == 'darwin':
        if architecture in ['arm64', 'aarch64'] or 'apple' in platform.processor().lower():
            return 'macosx-arm64'
        else:
            return 'macosx-x86_64'

    elif system == 'windows':
        return 'win-amd64'

    else:
        return 'unknown'


def is_windows() -> bool:
    """Check if current platform is Windows
    
    Returns:
        True if running on Windows, False otherwise
        
    Example:
        if is_windows(): executable_name += '.exe'
    """
    return get_platform_name().startswith('win')


def is_macos() -> bool:
    """Check if current platform is macOS
    
    Returns:
        True if running on macOS, False otherwise
        
    Example:
        if is_macos(): remove_quarantine_attribute(binary_path)
    """
    return get_platform_name().startswith('macosx')


def is_linux() -> bool:
    """Check if current platform is Linux
    
    Returns:
        True if running on Linux, False otherwise
        
    Example:
        if is_linux(): check_system_package('ffmpeg')
    """
    return get_platform_name().startswith('linux')


def format_bytes(bytes_val: float) -> str:
    """Format bytes into human-readable units
    
    Args:
        bytes_val: The number of bytes to format
        
    Returns:
        A human-readable string representation
        
    Example:
        format_bytes(1024) # returns "1 KB"
        format_bytes(1536) # returns "1.5 KB"
    """
    if bytes_val == 0:
        return "0 B"

    k = 1024
    sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    i = int(math.log(bytes_val) / math.log(k)) if bytes_val > 0 else 0
    return f"{round(bytes_val / (k ** i), 2)} {sizes[i]}"


def format_speed(speed: Union[float, str]) -> str:
    """Format speed from MB/s to human-readable format
    
    Args:
        speed: The speed in MB/s (pypdl format) or already formatted string
        
    Returns:
        A human-readable speed string
        
    Example:
        format_speed(1.5) # returns "1.5 MB/s" (pypdl returns in MB/s)
        format_speed("1.5 MB/s") # returns "1.5 MB/s" (already formatted)
    """
    if isinstance(speed, str):
        # If it's already formatted (e.g., "1.5 MB/s"), return as is
        if '/s' in speed:
            return speed
        # If it's a string number, convert to float
        try:
            speed = float(speed)
        except ValueError:
            return '0 B/s'

    if speed == 0:
        return '0 B/s'

    # pypdl returns speed in MB/s, convert to bytes/s for formatting
    bytes_per_sec = speed * 1024 * 1024
    return format_bytes(bytes_per_sec) + '/s'


def format_eta(eta_str: str) -> str:
    """Format ETA from HH:MM:SS to human-readable format
    
    Args:
        eta_str: The ETA in HH:MM:SS format (pypdl format)
        
    Returns:
        A human-readable ETA string
        
    Example:
        format_eta("01:02:30") # returns "1h 2m 30s"
        format_eta("00:02:30") # returns "2m 30s"
        format_eta("00:00:30") # returns "30s"
    """
    if not eta_str or eta_str == '∞':
        return '∞'

    try:
        # Parse HH:MM:SS format
        parts = eta_str.split(':')
        if len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = int(parts[2])

            if hours > 0:
                return f"{hours}h {minutes}m {seconds}s"
            elif minutes > 0:
                return f"{minutes}m {seconds}s"

            return f"{seconds}s"

        return eta_str
    except (ValueError, IndexError):
        return eta_str
