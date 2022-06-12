#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def rematch(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	decision = 0

	# Find entities
	# TODO: replace with confirmation resolver
	for item in params['entities']:
		if item['entity'] == 'number':
			decision = item['resolution']['value']

	if decision == 1:
		return utils.output('end', 'Let\'s goooo', {
			'isInActionLoop': False,
			'restart': True
		})

	return utils.output('end', 'As you wish', { 'isInActionLoop': False })
