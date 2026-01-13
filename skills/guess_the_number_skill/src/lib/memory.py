from bridges.python.src.sdk.memory import Memory
from typing import TypedDict
from datetime import datetime

game_memory = Memory({'name': 'game', 'default_memory': None})


class Game(TypedDict):
    number: int
    counter: int
    created_at: str


def create_new_game(number_to_guess: int) -> None:
    """Add new game"""
    game: Game = {
        'number': number_to_guess,
        'counter': 0,
        'created_at': datetime.now().isoformat()
    }
    game_memory.write(game)


def get_new_game() -> Game:
    """Get the newly created game"""
    return game_memory.read()


def set_counter(counter: int) -> None:
    """Set new trial counter value"""
    game = game_memory.read()
    game['counter'] = counter
    game_memory.write(game)
