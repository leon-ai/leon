from time import time

import utils

# Skill database
db = utils.db()['db']

# Game table
game_table = db.table('game')

# Time stamp
timestamp = int(time())


def create_new_game(nb_to_guess):
    """Add new game"""

    game_table.insert({
        'nb': nb_to_guess,
        'counter': 0,
        'created_at': timestamp
    })


def get_new_game():
    """Get the newly created game"""

    return game_table.all()[-1]


def set_counter(counter):
    """Set new trial counter value"""

    last_record_id = get_new_game().doc_id
    game_table.update({
        'counter': counter
    }, doc_ids=[last_record_id])
