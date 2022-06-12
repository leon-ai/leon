#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def setup(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']
	# if "init" phase: pickup nb and set counter
	counter = 0
	nb = 42

	# TODO: save these values in DB

	# TODO: add output_context
	return utils.output('end', 'ready')
