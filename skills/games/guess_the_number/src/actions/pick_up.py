#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def pick_up(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']

	return utils.output('end', 'ready', utils.translate('ready', {
		'players_nb': slots['players_nb']['value']['sourceText'],
		'email_test': slots['email_test']['value']['sourceText']
	}))
