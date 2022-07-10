#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import akinator, db

def setup(params):
	"""Initialize new session"""

	slots, lang = params['slots'], params['lang']
	thematic = slots['thematic']['resolution']['value']
	theme_lang = lang
	if thematic != 'characters':
		theme_lang = lang + '_' + thematic

	aki = akinator.Akinator()

	q = aki.start_game(theme_lang)

	db.upsert_session({
    	'response': aki.response,
    	'session': aki.session,
    	'progression': aki.progression,
    	'signature': aki.signature,
		'uri': aki.uri,
		'timestamp': aki.timestamp,
		'server': aki.server,
		'child_mode': aki.child_mode,
		'frontaddr': aki.frontaddr,
		'question_filter': aki.question_filter
    })

	return utils.output('end', q)
