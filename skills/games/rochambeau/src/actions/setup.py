#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def setup(params):
	"""This is a test"""

	entities, slots = params['entities'], params['slots']

	# TODO: use rounds_nb slot and save it in DB

	return utils.output('end', 'ready', utils.translate('ready'))
