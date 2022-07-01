#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

def quiz(params):
	"""TODO"""

	resolvers = params['resolvers']

	for resolver in resolvers:
		if resolver['name'] == 'mbti_quiz':
			answer = resolver['value']

	session = db.get_session()

	current_question = 1
	if session != None:
		current_question = session['current_question']

	db.upsert_session(current_question)

	current_question += 1

	if current_question == 20:
		# TODO
		return utils.output('end', 'Your personality type is...', { 'isInActionLoop': False })

	return utils.output('end', { 'key': current_question, 'data': { 'question': current_question }})
