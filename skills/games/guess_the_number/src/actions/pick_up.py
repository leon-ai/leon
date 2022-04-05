#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def pick_up(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	# if "init" phase: pickup nb and set counter
	counter = 0
	nb = 42

	# if "not init" phase: check nb + increment counter

	# TODO: "loop" option to return to the core
	return utils.output('end', 'ready', utils.translate('ready', {
		'players_nb': slots['players_nb']['value']['sourceText'],
		'email_test': slots['email_test']['value']['sourceText']
	}))
