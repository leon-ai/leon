#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def replay(params):
	"""This is a test"""

	entities, resolvers, slots = params['entities'], params['resolvers'], params['slots']
	decision = False

	# Find entities
	# TODO: replace with confirmation resolver
	for resolver in resolvers:
		if resolver['name'] == 'affirmation_denial':
			decision = resolver['value']

	if decision == True:
		return utils.output('end', 'replay', 'Let\'s goooo ' + str(decision), {
			'isInActionLoop': False,
			'restart': True
		})


	return utils.output('end', 'quit', 'As you wish ' + str(decision), { 'isInActionLoop': False })
