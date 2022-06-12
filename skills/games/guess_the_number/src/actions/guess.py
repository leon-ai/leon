#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def guess(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	given_nb = -1
	nb_to_guess = 42 # TODO: pick up from DB

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'number':
			given_nb = item['resolution']['value']

	# Return no speech if no number has been found
	if given_nb == -1:
		return utils.output('end', None, { 'isInActionLoop': False })

	if given_nb == nb_to_guess:
		return utils.output('end', '....CONGRATS.... Do you want to play another round?', { 'isInActionLoop': False })
	if nb_to_guess < given_nb:
		return utils.output('end', 'smaller')
	if nb_to_guess > given_nb:
		return utils.output('end', 'bigger')
