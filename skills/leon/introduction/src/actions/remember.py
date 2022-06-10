#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from datetime import datetime
from random import randint

def remember(params):
	"""Save name and birth date in Leon's memory"""

	slots = params['slots']
	owner_name = slots['owner_name']['value']['resolution']['value']
	owner_birth_date = slots['owner_birthdate']['value']['resolution']['value']

	return utils.output('end', 'default', utils.translate('default', { 'owner_name': owner_name }))
