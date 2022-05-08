#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def replay(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	decision = 0

	# Find entities
	# TODO: replace with confirmation resolver
	for item in params['entities']:
		if item['entity'] == 'number':
			decision = item['resolution']['value']

	if decision == 1:
		return utils.output('end', 'replay', 'Let\'s goooo', {
			'isInActionLoop': False,
			'restart': True
		})


	return utils.output('end', 'quit', 'As you wish', { 'isInActionLoop': False })
