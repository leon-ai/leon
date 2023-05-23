# TODO

import json
import os

from ..constants import SKILL_PATH, SKILLS_PATH


class Memory:
    def __init__(self, options):
        self.name = options.name
        self.default_memory = options.default_memory

        if ':' in options.name and options.name.count(':') == 3:
            domain_name, skill_name, memory_name = options.name.split(':')
            self.memory_path = os.path.join(
                SKILLS_PATH,
                domain_name,
                skill_name,
                'memory',
                memory_name + '.json'
            )
            if os.path.exists(self.memory_path):
                # TODO
                pass
        else:
            self.memory_path = os.path.join(
                SKILL_PATH,
                'memory',
                options.name + '.json'
            )

    def clear(self) -> None:
        if self.default_memory:
            self.write(self.default_memory)
        else:
            raise ValueError(f'You cannot clear the memory "{self.name}" as it belongs to another skill')

    def read(self):
        if not self.memory_path:
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
        if self.default_memory and self.memory_path:
            try:
                with open(self.memory_path, 'w') as f:
                    json.dump(memory, f, indent=2)

                return memory
            except Exception as e:
                print(f'Error while writing memory for "{self.name}": {e}')
                raise e
        else:
            raise ValueError(f'You cannot write into the memory "{self.name}" as it belongs to another skill')
