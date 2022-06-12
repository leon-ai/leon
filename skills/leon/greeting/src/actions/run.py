#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from datetime import datetime
from random import randint

def run(params):
	"""Leon greets you"""

	time = datetime.time(datetime.now())

	# 1/2 chance to get deeper greetings
	if randint(0, 1) != 0:
		if time.hour >= 5 and time.hour <= 10:
			return utils.output('end', 'morning_good_day')
		if time.hour == 11:
			return utils.output('end', 'morning')
		if time.hour >= 12 and time.hour <= 17:
			return utils.output('end', 'afternoon')
		if time.hour >= 18 and time.hour <= 21:
			return utils.output('end', 'evening')
		if time.hour >= 22 and time.hour <= 23:
			return utils.output('end', 'night')

		return utils.output('end', 'too_late')

	return utils.output('end', 'default')
