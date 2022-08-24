#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def retry(params):
	"""Ask for a retry"""

	resolvers = params['resolvers']
	decision = False

	for resolver in resolvers:
		if resolver['name'] == 'affirmation_denial':
			decision = resolver['value']

	if decision == True:
		return utils.output('end', 'confirm_retry', {
			'isInActionLoop': False,
			'restart': True
		})

	return utils.output('end', 'deny_retry', { 'isInActionLoop': False })
