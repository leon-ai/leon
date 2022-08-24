#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import db

owner = db.get_owner()

def introduce_leon(params):
	"""Leon introduces himself and
	ask about you if he does not know you yet"""

	is_owner_saved = owner != None

	if is_owner_saved == False:
		return utils.output('end', 'leon_introduction_with_question')

	return utils.output('end', 'leon_introduction')
