import json
import os
import ntpath
import posixpath
from typing import Dict, Any, Optional

from ..constants import LEON_PROFILES_PATH, LEON_PROFILE_NAME, TOOLS_PATH
from .utils import get_platform_name


def resolve_tool_directory(root: str, toolkit_id: str, tool_id: str) -> str:
    """Prefer nested tools, accepting flat layouts only for matching manifests."""
    nested = os.path.join(root, toolkit_id, tool_id)
    if os.path.exists(os.path.join(nested, "tool.json")):
        return nested
    flat = os.path.join(root, toolkit_id)
    try:
        with open(os.path.join(flat, "tool.json"), encoding="utf-8") as source:
            manifest = json.load(source)
        if (isinstance(manifest, dict)
                and manifest.get("toolkit_id") == toolkit_id
                and manifest.get("tool_id") == tool_id):
            return flat
    except (OSError, ValueError):
        # Leave invalid or missing manifests to the caller's configuration error.
        pass
    return nested


def merge_missing_settings(
    default_settings: Dict[str, Any], existing_settings: Dict[str, Any]
) -> Dict[str, Any]:
    merged_settings = {**existing_settings}

    for key, default_value in default_settings.items():
        if key not in existing_settings:
            merged_settings[key] = default_value
            continue

        existing_value = existing_settings[key]
        if isinstance(default_value, dict) and isinstance(existing_value, dict):
            merged_settings[key] = merge_missing_settings(
                default_value, existing_value
            )

    return merged_settings


class ToolkitConfig:
    """Toolkit configuration loader"""

    _config_cache: Dict[str, Dict[str, Any]] = {}
    _settings_cache: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def load(cls, toolkit_name: str, tool_name: str) -> Dict[str, Any]:
        """
        Load tool configuration from the flat tools structure.

        Args:
            toolkit_name: The toolkit name (e.g., 'video_streaming')
            tool_name: Name of the tool (e.g., 'ffmpeg')
        """
        cache_key = toolkit_name

        # Load toolkit config if not cached
        if cache_key not in cls._config_cache:
            config_path = os.path.join(TOOLS_PATH, toolkit_name, "toolkit.json")

            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    toolkit_config = json.load(f)
            except (FileNotFoundError, json.JSONDecodeError) as e:
                raise Exception(
                    f"Failed to load toolkit config from '{config_path}': {str(e)}"
                )

            cls._config_cache[cache_key] = toolkit_config

        toolkit_config = cls._config_cache[cache_key]
        tools_list = toolkit_config.get("tools", [])

        tool_config_path = os.path.join(
            resolve_tool_directory(TOOLS_PATH, toolkit_name, tool_name), "tool.json"
        )

        if tool_name not in tools_list and not os.path.exists(tool_config_path):
            toolkit_name_display = toolkit_config.get("name", "unknown")
            raise Exception(
                f"Tool '{tool_name}' not found in toolkit '{toolkit_name_display}'"
            )

        try:
            with open(tool_config_path, "r", encoding="utf-8") as f:
                tool_config = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError) as e:
            raise Exception(
                f"Failed to load tool config from '{tool_config_path}': {str(e)}"
            )

        return tool_config

    @classmethod
    def load_tool_settings(
        cls,
        toolkit_name: str,
        tool_name: str,
        defaults: Optional[Dict[str, Any]] = None,
        refresh: bool = False,
        profile_name: str = LEON_PROFILE_NAME,
    ) -> Dict[str, Any]:
        """
        Load tool-specific settings from toolkit settings file

        Args:
            toolkit_name: The toolkit name (e.g., 'video_streaming')
            tool_name: Name of the tool (e.g., 'ffmpeg')
            defaults: Default tool settings to apply when missing
            refresh: Reload settings after owner edits
            profile_name: Owning profile, independent of the active conversation
        """
        profile_name = profile_name.strip()
        if (not profile_name or profile_name in (".", "..")
                or ":" in profile_name
                or posixpath.basename(profile_name) != profile_name
                or ntpath.basename(profile_name) != profile_name):
            raise ValueError(f'Invalid Leon profile name "{profile_name}".')
        cache_key = f"{profile_name}:{toolkit_name}:{tool_name}"
        if not refresh and cache_key in cls._settings_cache:
            return cls._settings_cache[cache_key]

        settings_path = os.path.join(
            LEON_PROFILES_PATH, profile_name, "tools", toolkit_name, tool_name, "settings.json"
        )
        settings_sample_path = os.path.join(
            resolve_tool_directory(TOOLS_PATH, toolkit_name, tool_name), "settings.sample.json"
        )
        settings_dir = os.path.dirname(settings_path)
        os.makedirs(settings_dir, exist_ok=True)
        default_settings = defaults or {}

        if os.path.exists(settings_sample_path):
            try:
                with open(settings_sample_path, "r", encoding="utf-8") as f:
                    default_settings = json.load(f)
            except json.JSONDecodeError as e:
                raise Exception(
                    f"Failed to load tool settings sample from '{settings_sample_path}': {str(e)}"
                )

        tool_settings: Dict[str, Any] = {}
        should_write = False

        if os.path.exists(settings_path):
            try:
                with open(settings_path, "r", encoding="utf-8") as f:
                    tool_settings = json.load(f)
            except json.JSONDecodeError as e:
                raise Exception(
                    f"Failed to load toolkit settings from '{settings_path}': {str(e)}"
                )
        else:
            should_write = True

        merged_settings = merge_missing_settings(default_settings, tool_settings)

        if not should_write:
            should_write = tool_settings != merged_settings

        if should_write:
            with open(settings_path, "w", encoding="utf-8") as f:
                json.dump(merged_settings, f, indent=2)

        cls._settings_cache[cache_key] = merged_settings
        return merged_settings

    @classmethod
    def get_binary_url(cls, config: Dict[str, Any]) -> Optional[str]:
        """Get binary download URL for current platform with architecture granularity"""
        platform_name = get_platform_name()
        binaries = config.get("binaries", {})

        return binaries.get(platform_name)
