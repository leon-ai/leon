#!/usr/bin/env python
# -*- coding:utf-8 -*-

import random
import utils

def play(params):
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
	leon = {
		'handsign': random.choice(list(handsigns)),
		'points': 0
	}

	# Find entities
	for entity in entities:
		if entity['entity'] == 'handsign':
			player['handsign'] = entity['option']

	# Exit the loop if no handsign has been found
	if player['handsign'] == None:
		utils.output('inter', None, None, { 'isInActionLoop': False })

	leon_emoji = handsigns[leon['handsign']]['emoji']
	player_emoji = handsigns[player['handsign']]['emoji']

	utils.output('inter', { 'key': 'leon_emoji', 'data': { 'leon_emoji': leon_emoji } })

	if leon['handsign'] == player['handsign']:
		utils.output('inter', 'equal')

	# Point for Leon
	elif handsigns[leon['handsign']]['superior_to'] == player['handsign']:
		utils.output('inter', { 'key': 'point_for_leon',
			'data': {
				'handsign_1': leon['handsign'].lower(),
				'handsign_2': player['handsign'].lower()
			}
		})

	else:
		utils.output('inter', { 'key': 'point_for_player',
			'data': {
				'handsign_1': player['handsign'].lower(),
				'handsign_2': leon['handsign'].lower()
			}
		})

	return utils.output('end', 'ask_for_rematch', { 'isInActionLoop': False })
