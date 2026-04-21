import json
import os
from typing import Dict, Any, Optional

from ..constants import PROFILE_TOOLS_PATH, TOOLKITS_PATH
from .utils import get_platform_name


class ToolkitConfig:
    """Toolkit configuration loader"""

    _config_cache: Dict[str, Dict[str, Any]] = {}
    _settings_cache: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def load(cls, toolkit_name: str, tool_name: str) -> Dict[str, Any]:
        """
        Load tool configuration from bridges/toolkits directory

        Args:
            toolkit_name: The toolkit name (e.g., 'video_streaming')
            tool_name: Name of the tool (e.g., 'ffmpeg')
        """
        cache_key = toolkit_name

        # Load toolkit config if not cached
        if cache_key not in cls._config_cache:
            config_path = os.path.join(TOOLKITS_PATH, toolkit_name, "toolkit.json")

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
            TOOLKITS_PATH, toolkit_name, "tools", f"{tool_name}.tool.json"
        )

        # toolkit.json remains the discovery surface for agent/runtime registry
        # flows, but direct skill-side tool usage should still work when the
        # tool manifest exists.
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
    ) -> Dict[str, Any]:
        """
        Load tool-specific settings from toolkit settings file

        Args:
            toolkit_name: The toolkit name (e.g., 'video_streaming')
            tool_name: Name of the tool (e.g., 'ffmpeg')
            defaults: Default tool settings to apply when missing
        """
        cache_key = f"{toolkit_name}:{tool_name}"
        if cache_key in cls._settings_cache:
            return cls._settings_cache[cache_key]

        settings_path = os.path.join(PROFILE_TOOLS_PATH, f"{tool_name}.settings.json")
        settings_dir = os.path.dirname(settings_path)
        os.makedirs(settings_dir, exist_ok=True)

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

        defaults = defaults or {}
        merged_settings = {**defaults, **tool_settings}

        if not should_write:
            for key in defaults.keys():
                if key not in tool_settings:
                    should_write = True
                    break

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
