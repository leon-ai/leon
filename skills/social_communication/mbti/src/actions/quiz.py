#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def quiz(params):
	"""TODO"""

	resolvers = params['resolvers']

	for resolver in resolvers:
		if resolver['name'] == 'mbti_quiz':
			answer = resolver['value']

	print('answer', answer)
