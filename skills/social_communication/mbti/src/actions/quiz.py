#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

def quiz(params):
	"""Loop over the questions and track choices"""

	resolvers = params['resolvers']

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
