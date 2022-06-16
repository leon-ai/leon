#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

def remember(params):
	"""Save name and birth date into Leon's memory"""

	slots = params['slots']
	owner_name = slots['owner_name']['resolution']['value']
	owner_birth_date = slots['owner_birth_date']['resolution']['timex']

	db.upsert_owner(owner_name, owner_birth_date)

	return utils.output('end', { 'key': 'remembered',
		'data': { 'owner_name': owner_name }
	})
