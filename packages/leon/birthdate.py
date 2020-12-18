#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def date(string, entities):
	"""Leon says when it was created"""

	return utils.output('end', 'date', utils.translate('date'))

def birthday(string, entities):
	"""Leon says when is it's birthday"""

	return utils.output('end', 'birthday', utils.translate('birthday'))