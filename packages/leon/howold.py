#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
import datetime

def run(string, entities):
	"""Leon says it's age"""

	age = datetime.date.today() - datetime.date(2019, 2, 10)

	data = {
		'years': int(age.days / 365),
		'days': (age.days % 365)
	}

	return utils.output('end', 'age', utils.translate('age', data))
