#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from datetime import datetime
from random import randint

def greeting(string, entities):
	"""Leon greets you"""

	time = datetime.time(datetime.now())

	# 1/2 chance to get deeper greetings
	if randint(0, 1) != 0:
		if time.hour >= 5 and time.hour <= 10:
			return utils.output('end', 'morning_good_day', utils.translate('morning_good_day'))
		if time.hour == 11:
			return utils.output('end', 'morning', utils.translate('morning'))
		if time.hour >= 12 and time.hour <= 17:
			return utils.output('end', 'afternoon', utils.translate('afternoon'))
		if time.hour >= 18 and time.hour <= 21:
			return utils.output('end', 'evening', utils.translate('evening'))
		if time.hour >= 22 and time.hour <= 23:
			return utils.output('end', 'night', utils.translate('night'))

		return utils.output('end', 'too_late', utils.translate('too_late'))

	return utils.output('end', 'default', utils.translate('default'))
