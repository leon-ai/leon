#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def guess(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	given_nb = -1
	nb_to_guess = 42 # TODO: pick up from DB

	# Find entities
	# TODO: if no number entity found, then break the action loop
	for item in params['entities']:
		if item['entity'] == 'number':
			given_nb = item['resolution']['value']

	if given_nb == nb_to_guess:
		return utils.output('end', 'guessed', '....CONGRATS....')
	if nb_to_guess < given_nb:
		return utils.output('end', 'smaller', utils.translate('smaller'))
	if nb_to_guess > given_nb:
		return utils.output('end', 'bigger', utils.translate('bigger'))
