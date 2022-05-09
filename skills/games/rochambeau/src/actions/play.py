#!/usr/bin/env python
# -*- coding:utf-8 -*-

import random
import utils

def play(params):
	"""This is a test"""

	handsigns = {
		'ROCK': {
			'superior_to': 'scissors',
			'inferior_to': 'paper'
		},
		'PAPER': {
			'superior_to': 'rock',
			'inferior_to': 'scissors'
		},
		'SCISSORS': {
			'superior_to': 'paper',
			'inferior_to': 'rock'
		}
	}
	entities = params['entities']
	rounds_nb = 3 # TODO: pickup from memory
	player_handsign = None
	leon_handsign = random.choice(list(handsigns))

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'handsign':
			player_handsign = item['resolution']['value']

	# Return no speech if no number has been found
	if player_handsign == None:
		return utils.output('end', None, None, { 'isInActionLoop': False })

	if leon_handsign == player_handsign:
		return utils.output('end', 'equal', utils.translate('equal'))

	# Point for Leon
	if handsigns[leon_handsign]['superior_to'] == player_handsign:
		# TODO: increment +1 for Leon
		# TODO: remove print
		print('...')

	# TODO: increment +1 for player

	return utils.output('end', 'equal', utils.translate('point', {
		'handsign_1': leon_handsign.lower(),
		'handsign_2': player_handsign.lower()
	}))
