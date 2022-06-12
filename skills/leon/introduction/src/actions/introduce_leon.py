#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def introduce_leon(params):
	"""TODO"""

	has_info = True

	if has_info == False:
		# return utils.output('end', 'remembered', utils.translate('remembered', { 'owner_name': owner_name }))
		return utils.output('end', 'leon_introduction_with', utils.translate('remembered', { 'owner_name': owner_name }))

	return utils.output('end', 'leon_introduction')
	# return utils.output('end', 'leon_introduction', utils.translate('leon_introduction'))
