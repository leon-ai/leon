from bridges.python.src.sdk.memory import Memory
from typing import TypedDict, Union


class Owner(TypedDict):
    name: str
    birth_date: str


owner_memory = Memory({'name': 'owner', 'default_memory': None})


def upsert_owner(owner: Owner) -> None:
    """Save basic information about the owner"""
    owner_memory.write(owner)


def get_owner() -> Union[Owner, None]:
    """Get owner's basic information"""
    return owner_memory.read()
