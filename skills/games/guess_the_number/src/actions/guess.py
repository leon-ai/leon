#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

def guess(params):
	"""Check whether the given number matches the chosen number"""

	entities, slots = params['entities'], params['slots']
	given_nb = -1
	nb_to_guess = db.get_new_game()['nb']

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'number':
			given_nb = item['resolution']['value']

	# Return no speech if no number has been found
	if given_nb == -1:
		return utils.output('end', None, { 'isInActionLoop': False })

	counter = db.get_new_game()['counter'] + 1
	db.set_counter(counter)

	if given_nb == nb_to_guess:
		return utils.output('end', { 'key': 'guessed',
			'data': {
				'nb': nb_to_guess,
				'attempts_nb': counter
			}
		}, { 'isInActionLoop': False })
	if nb_to_guess < given_nb:
		return utils.output('end', 'smaller')
	if nb_to_guess > given_nb:
		return utils.output('end', 'bigger')
