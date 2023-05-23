# TODO

import os.path

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
