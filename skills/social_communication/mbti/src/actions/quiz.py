#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

counters = {
	'mind': {
		'E': 0, # Extraverted
		'I': 0, # Introverted
		'questions': [1, 5, 9, 13, 17]
	},
	'energy': {
		'N': 0, # Intuitive
		'S': 0, # Sensing
		'questions': [2, 6, 10, 14, 18]
	},
	'nature': {
		'T': 0, # Thinking
		'F': 0, # Feeling
		'questions': [3, 7, 11, 15, 19]
	},
	'tactics': {
		'J': 0, # Judjing
		'P': 0, # Perceiving
		'questions': [4, 8, 12, 16, 20]
	}
}

def quiz(params):
	"""Loop over the questions and track choices"""

	resolvers = params['resolvers']
	choice = None

	for resolver in resolvers:
		if resolver['name'] == 'form':
			choice = resolver['value']

	session = db.get_session()
	current_question = session['current_question'] + 1
	db.upsert_session(current_question)

	if current_question == 20:
		# TODO
		return utils.output('end', 'Your personality type is...', { 'isInActionLoop': False })

	return utils.output('end', { 'key': str(current_question),
		'data': {
			'question': str(current_question)
		}
	})
