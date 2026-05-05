import argparse
import ctypes
import glob
import os
import sys
import threading
from os.path import join
from dotenv import load_dotenv

DEFAULT_LEON_PROFILE = "just-me"
DEFAULT_TCP_SERVER_HOST = "127.0.0.1"
DEFAULT_TCP_SERVER_PORT = 5_367


def resolve_leon_home() -> str:
    configured_leon_home = os.getenv("LEON_HOME", "").strip()

    if configured_leon_home:
        return os.path.abspath(configured_leon_home)

    return os.path.join(os.path.expanduser("~"), ".leon")


def resolve_leon_profile() -> str:
    return os.getenv("LEON_PROFILE", "").strip() or DEFAULT_LEON_PROFILE


def resolve_leon_profile_path() -> str:
    configured_profile_path = os.getenv("LEON_PROFILE_PATH", "").strip()

    if configured_profile_path:
        return os.path.abspath(configured_profile_path)

    return os.path.join(resolve_leon_home(), "profiles", resolve_leon_profile())


def _resolve_torch_root(pytorch_path: str) -> str | None:
    normalized_path = os.path.abspath(pytorch_path)
    if os.path.basename(normalized_path) == "torch" and os.path.isfile(
        os.path.join(normalized_path, "__init__.py")
    ):
        return normalized_path

    torch_candidate = os.path.join(normalized_path, "torch")
    if os.path.isfile(os.path.join(torch_candidate, "__init__.py")):
        return torch_candidate

    torch_nested_candidate = os.path.join(normalized_path, "torch", "torch")
    if os.path.isfile(os.path.join(torch_nested_candidate, "__init__.py")):
        return torch_nested_candidate

    return None


def _add_pytorch_path(pytorch_path: str | None) -> str | None:
    if not pytorch_path:
        return None

    torch_root = _resolve_torch_root(pytorch_path)
    if torch_root:
        sys.path.insert(0, os.path.dirname(torch_root))
        return torch_root

    sys.path.insert(0, os.path.abspath(pytorch_path))
    return None


def _set_library_paths(paths: list[str]) -> None:
    if not paths:
        return

    existing_path = ""

    if sys.platform.startswith("win"):
        add_dll_directory = getattr(os, "add_dll_directory", None)
        for path in paths:
            if os.path.isdir(path) and add_dll_directory:
                add_dll_directory(path)
        existing_path = os.environ.get("PATH", "")
        os.environ["PATH"] = (
            os.pathsep.join([*paths, existing_path])
            if existing_path
            else os.pathsep.join(paths)
        )
        return

    if sys.platform == "darwin":
        existing_path = os.environ.get("DYLD_LIBRARY_PATH", "")
        os.environ["DYLD_LIBRARY_PATH"] = (
            os.pathsep.join([*paths, existing_path])
            if existing_path
            else os.pathsep.join(paths)
        )
        return

    existing_path = os.environ.get("LD_LIBRARY_PATH", "")
    os.environ["LD_LIBRARY_PATH"] = (
        os.pathsep.join([*paths, existing_path])
        if existing_path
        else os.pathsep.join(paths)
    )


def _configure_external_libraries(
    pytorch_path: str | None, nvidia_path: str | None
) -> None:
    lib_paths = []
    torch_root = _add_pytorch_path(pytorch_path)

    if torch_root:
        torch_lib_path = os.path.join(torch_root, "lib")
        if os.path.isdir(torch_lib_path):
            lib_paths.append(torch_lib_path)

    if nvidia_path:
        nvidia_root = os.path.abspath(nvidia_path)
        nvjitlink_pattern = os.path.join(
            nvidia_root, "nvjitlink", "lib", "libnvJitLink.so.*"
        )
        for library in [
            "cublas",
            "cudnn",
            "cusparse",
            "cusparse_full",
            "nccl",
            "nvshmem",
            "nvjitlink",
        ]:
            candidate = os.path.join(nvidia_root, library, "lib")
            if os.path.isdir(candidate):
                lib_paths.append(candidate)

        if sys.platform.startswith("linux"):
            nvjitlink_candidates = sorted(glob.glob(nvjitlink_pattern), reverse=True)
            if nvjitlink_candidates:
                ctypes.CDLL(nvjitlink_candidates[0], mode=ctypes.RTLD_GLOBAL)

    _set_library_paths(lib_paths)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Leon TCP server")
    parser.add_argument(
        "lang", nargs="?", default="en", help="Language code (e.g. en, fr)"
    )
    parser.add_argument("--pytorch-path", dest="pytorch_path", type=str, default=None)
    parser.add_argument("--nvidia-path", dest="nvidia_path", type=str, default=None)
    return parser.parse_args()


args = _parse_args()
os.environ["LEON_PY_TCP_SERVER_LANG"] = args.lang
_configure_external_libraries(args.pytorch_path, args.nvidia_path)

dotenv_path = join(resolve_leon_profile_path(), ".env")
load_dotenv(dotenv_path)

from lib.tcp_server import TCPServer

tcp_server_host = os.environ.get("LEON_PY_TCP_SERVER_HOST", DEFAULT_TCP_SERVER_HOST)
tcp_server_port = os.environ.get("LEON_PY_TCP_SERVER_PORT", DEFAULT_TCP_SERVER_PORT)

tcp_server = TCPServer(tcp_server_host, tcp_server_port)

# Use thread as ASR starts recording audio and it blocks the main thread
asr_thread = threading.Thread(target=tcp_server.init_asr)
asr_thread.start()

tcp_server.init_tts()

tcp_server_thread = threading.Thread(target=tcp_server.init)
tcp_server_thread.start()
