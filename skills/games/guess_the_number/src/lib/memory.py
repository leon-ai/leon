from bridges.python.src.sdk.memory import Memory
from typing import TypedDict
from time import time

games_memory = Memory({'name': 'games', 'default_memory': []})


class Game(TypedDict):
    number: int
    counter: int
    created_at: int


def create_new_game(number_to_guess: int) -> None:
    """Add new game"""
    games: list[Game] = games_memory.read()
    game: Game = {
        'number': number_to_guess,
        'counter': 0,
        'created_at': int(time())
    }
    games.append(game)
    games_memory.write(games)


def get_new_game() -> Game:
    """Get the newly created game"""
    return games_memory.read()[-1]


def set_counter(counter: int) -> None:
    """Set new trial counter value"""
    games = games_memory.read()
    games[-1]['counter'] = counter
    games_memory.write(games)
