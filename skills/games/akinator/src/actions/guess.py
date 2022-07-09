#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import akinator, db

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

	new_session = db.get_new_session()
	response = new_session['response']
	formatted_response = aki._parse_response(response)
	aki.session = new_session['session']
	aki.signature = new_session['signature']
	aki.progression = new_session['progression']
	aki.uri = new_session['uri']
	aki.timestamp = new_session['timestamp']
	aki.server = new_session['server']
	aki.child_mode = new_session['child_mode']
	aki.frontaddr = new_session['frontaddr']
	aki.question_filter = new_session['question_filter']

	resp = aki._parse_response(response)
	aki._update(resp, '"step":"0"' in response)

	if new_session['progression'] > 80:
		aki.win()
		# name; description; absolute_picture_path
		return utils.output('end', aki.first_guess['name'])

	aki.answer(answer)

	db.create_new_session({
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

	return utils.output('end', aki.question)
