#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import akinator, db

# TODO: emit suggestion on each question of the loop
# TODO: catch network error
# TODO: timeout on question/answer

def guess(params):
	resolvers = params['resolvers']
	answer = None

	for resolver in resolvers:
		if resolver['name'] == 'answer':
			answer = resolver['value']

	# Return no speech if no value has been found
	if answer == None:
		return utils.output('end', None, { 'isInActionLoop': False })

	aki = akinator.Akinator()

	session = db.get_session()
	response = session['response']
	formatted_response = aki._parse_response(response)
	aki.session = session['session']
	aki.signature = session['signature']
	aki.progression = session['progression']
	aki.uri = session['uri']
	aki.timestamp = session['timestamp']
	aki.server = session['server']
	aki.child_mode = session['child_mode']
	aki.frontaddr = session['frontaddr']
	aki.question_filter = session['question_filter']

	resp = aki._parse_response(response)
	aki._update(resp, '"step":"0"' in response)

	if session['progression'] > 80:
		aki.win()

		utils.output('inter', { 'key': 'guessed', 'data': {
			'name': aki.first_guess['name'],
			'description': aki.first_guess['description']
		}})

		utils.output('inter', { 'key': 'guessed_img', 'data': {
			'name': aki.first_guess['name'],
			'url': aki.first_guess['absolute_picture_path']
		}})

		return utils.output('end', 'ask_for_retry', {
			'isInActionLoop': False, 'showSuggestions': True
		})

	aki.answer(answer)

	db.upsert_session({
        'response': aki.response,
		'session': aki.session,
		'signature': aki.signature,
		'progression': aki.progression,
        'uri': aki.uri,
        'timestamp': aki.timestamp,
        'server': aki.server,
        'child_mode': aki.child_mode,
        'frontaddr': aki.frontaddr,
        'question_filter': aki.question_filter
    })

	return utils.output('end', aki.question, { 'showSuggestions': True })
