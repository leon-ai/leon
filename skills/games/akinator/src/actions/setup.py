#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import akinator, db

def setup(params):
	aki = akinator.Akinator()

	q = aki.start_game('en')

	db.create_new_session({
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
