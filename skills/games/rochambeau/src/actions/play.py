from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams

import random


def run(params: ActionParams) -> None:
    """Define the winner"""

    handsigns = {
        'ROCK': {
            'superior_to': 'SCISSORS',
            'inferior_to': 'PAPER',
            'emoji': '✊'
        },
        'PAPER': {
            'superior_to': 'ROCK',
            'inferior_to': 'SCISSORS',
            'emoji': '✋'
        },
        'SCISSORS': {
            'superior_to': 'PAPER',
            'inferior_to': 'ROCK',
            'emoji': '✌'
        }
    }
    entities = params['entities']
    player = {
        'handsign': None,
        'points': 0
    }
    leon_player = {
        'handsign': random.choice(list(handsigns)),
        'points': 0
    }

    # Find entities
    for entity in entities:
        if entity['entity'] == 'handsign':
            player['handsign'] = entity['option']

    # Exit the loop if no handsign has been found
    if player['handsign'] is None:
        leon.answer({'core': {'isInActionLoop': False}})

    leon_emoji = handsigns[leon_player['handsign']]['emoji']
    player_emoji = handsigns[player['handsign']]['emoji']

    leon.answer({'key': 'leon_emoji', 'data': {'leon_emoji': leon_emoji}})

    if leon_player['handsign'] == player['handsign']:
        leon.answer({'key': 'equal'})

    # Point for Leon
    elif handsigns[leon_player['handsign']]['superior_to'] == player['handsign']:
        leon.answer({
            'key': 'point_for_leon',
            'data': {
                'handsign_1': leon_player['handsign'].lower(),
                'handsign_2': player['handsign'].lower()
            }
        })

    else:
        leon.answer({
            'key': 'point_for_player',
            'data': {
                'handsign_1': player['handsign'].lower(),
                'handsign_2': leon_player['handsign'].lower()
            }
        })

    leon.answer({
        'key': 'ask_for_rematch',
        'core': {
            'isInActionLoop': False,
            'showNextActionSuggestions': True
        }
    })
