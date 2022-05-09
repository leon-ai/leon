#!/usr/bin/env python
# -*- coding:utf-8 -*-

import random
import utils

def play(params):
	"""This is a test"""

	handsigns = {
		'ROCK': {
			'superior_to': 'SCISSORS',
			'inferior_to': 'PAPER'
		},
		'PAPER': {
			'superior_to': 'ROCK',
			'inferior_to': 'SCISSORS'
		},
		'SCISSORS': {
			'superior_to': 'PAPER',
			'inferior_to': 'ROCK'
		}
	}
	entities = params['entities']
	rounds_nb = 3 # TODO: pickup from memory
	player = {
		'handsign': None,
		'points': 0
	}
	leon = {
		'handsign': random.choice(list(handsigns)),
		'points': 0
	}

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'handsign':
			player['handsign'] = item['option']

	# Return no speech if no number has been found
	if player['handsign'] == None:
		return utils.output('end', None, None, { 'isInActionLoop': False })

	if leon['handsign'] == player['handsign']:
		return utils.output('end', 'equal', utils.translate('equal'))

	# Point for Leon
	if handsigns[leon['handsign']]['superior_to'] == player['handsign']:
		# TODO: increment +1 for Leon
		return utils.output('end', 'point_for_leon', utils.translate('point_for_leon', {
			'handsign_1': leon['handsign'].lower(),
			'handsign_2': player['handsign'].lower()
		}))

	# TODO: increment +1 for player

	return utils.output('end', 'point_for_player', utils.translate('point_for_player', {
		'handsign_1': player['handsign'].lower(),
		'handsign_2': leon['handsign'].lower()
	}))
