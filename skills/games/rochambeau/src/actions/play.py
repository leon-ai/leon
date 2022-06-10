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
	entities, slots = params['entities'], params['slots']
	# TODO: make resolution more simple. E.g. slots['rounds_nb']['strValue']. Same for entities
	rounds_nb = str(slots['rounds_nb']['value']['resolution']['value'])
	testo_email = str(slots['testo_email']['value']['resolution']['value'])
	testo_nb = str(slots['testo_nb']['value']['resolution']['value'])
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

	utils.output('inter', 'testo', 'Just a test: ' + rounds_nb + ' + ' + testo_email + ' + ' + testo_nb)

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
