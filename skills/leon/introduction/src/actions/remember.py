#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from datetime import datetime
from random import randint

def remember(params):
	"""Save name and birth date into Leon's memory"""

	slots = params['slots']
	owner_name = slots['owner_name']['resolution']['value']
	owner_birth_date = slots['owner_birth_date']['resolution']['timex']

	return utils.output('end', 'remembered', utils.translate('remembered', { 'owner_name': owner_name }))
