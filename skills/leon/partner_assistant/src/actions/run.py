#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def run(string, entities):
	"""Leon tells you about other personal assistants"""

	partner = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'partner_assistant':
			partner = item['option'].lower()
			return utils.output('end', 'success', utils.translate(partner.replace(' ', '_')))

	return utils.output('end', 'unknown', utils.translate('unknown'))
