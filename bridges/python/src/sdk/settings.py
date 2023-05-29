import json
import os
from os import path
from typing import Union, Any, overload

from ..constants import SKILL_PATH


class Settings:
    def __init__(self):
        self.settings_path = path.join(SKILL_PATH, 'src', 'settings.json')
        self.settings_sample_path = path.join(SKILL_PATH, 'src', 'settings.sample.json')

    def is_setting_set(self, key: str) -> bool:
        """
        Check if a setting is already set
        :param key: The key to verify whether its value is set
        """
        settings_sample = self.get_settings_sample()
        settings = self.get()

        return key in settings and json.dumps(settings[key]) != json.dumps(settings_sample[key])

    def clear(self) -> None:
        """
        Clear the settings and set it to the default settings.sample.json file
        """
        settings_sample = self.get_settings_sample()
        self.set(settings_sample)

    def get_settings_sample(self) -> dict[str, Any]:
        try:
            with open(self.settings_sample_path, 'r') as file:
                return json.load(file)
        except Exception as e:
            print(f"Error while reading settings sample at '{self.settings_sample_path}': {e}")
            raise e

    @overload
    def get(self, key: str) -> Any: ...

    @overload
    def get(self, key: None = None) -> dict[str, Any]: ...

    def get(self, key: Union[str, None] = None) -> Union[dict[str, Any], Any]:
        """
        Get the settings
        :param key: The key to get from the settings
        """
        try:
            if not os.path.exists(self.settings_path):
                self.clear()

            with open(self.settings_path, 'r') as file:
                settings = json.load(file)

                if key is not None:
                    return settings[key]

                return settings
        except Exception as e:
            print(f"Error while reading settings at '{self.settings_path}': {e}")
            raise e

    @overload
    def set(self, key_or_settings: dict[str, Any]) -> dict[str, Any]: ...

    @overload
    def set(self, key_or_settings: str, value: Any) -> dict[str, Any]: ...

    def set(self, key_or_settings: Union[str, dict[str, Any]], value: Any = None) -> dict[str, Any]:
        """
        Set the settings
        :param key_or_settings: The key to set or the settings to set
        :param value: The value to set
        """
        try:
            settings = self.get()

            if isinstance(key_or_settings, dict):
                new_settings = key_or_settings
            else:
                new_settings = {**settings, key_or_settings: value}

            with open(self.settings_path, 'w') as file:
                json.dump(new_settings, file, indent=2)

            return new_settings
        except Exception as e:
            print(f"Error while writing settings at '{self.settings_path}': {e}")
            raise e
