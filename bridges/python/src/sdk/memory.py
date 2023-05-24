import json
import os
from typing import TypedDict, Any

from ..constants import SKILL_PATH, SKILLS_PATH


class MemoryOptions(TypedDict, total=False):
    name: str
    default_memory: Any


class Memory:
    def __init__(self, options: MemoryOptions):
        self.name = options['name']
        self.default_memory = options['default_memory'] if 'default_memory' in options else None
        self.memory_path = None
        self.__is_from_another_skill = False

        if ':' in self.name and self.name.count(':') == 2:
            self.__is_from_another_skill = True
            domain_name, skill_name, memory_name = self.name.split(':')
            memory_path = os.path.join(
                SKILLS_PATH,
                domain_name,
                skill_name,
                'memory',
                memory_name + '.json'
            )

            if os.path.exists(memory_path):
                self.memory_path = memory_path
        else:
            self.memory_path = os.path.join(
                SKILL_PATH,
                'memory',
                self.name + '.json'
            )

    def clear(self) -> None:
        """
        Clear the memory and set it to the default memory value
        """
        if not self.__is_from_another_skill:
            self.write(self.default_memory)
        else:
            raise ValueError(f'You cannot clear the memory "{self.name}" as it belongs to another skill')

    def read(self):
        """
        Read the memory
        """
        if not self.memory_path and self.__is_from_another_skill:
            raise ValueError(f'You cannot read the memory "{self.name}" as it belongs to another skill which hasn\'t written to this memory yet')

        try:
            if not os.path.exists(self.memory_path):
                self.clear()

            with open(self.memory_path, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f'Error while reading memory for "{self.name}": {e}')
            raise e

    def write(self, memory):
        """
        Write the memory
        :param memory: The memory to write
        """
        if self.memory_path is not None and not self.__is_from_another_skill:
            try:
                with open(self.memory_path, 'w') as f:
                    json.dump(memory, f, indent=2)

                return memory
            except Exception as e:
                print(f'Error while writing memory for "{self.name}": {e}')
                raise e
        else:
            raise ValueError(f'You cannot write into the memory "{self.name}" as it belongs to another skill')
