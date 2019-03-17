#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

def partnerassistant(string, entities):
	"""Leon tells you about other personal assistants"""

	string = string.lower()

	assistants = [
		'alexa',
		'cortana',
		'siri',
		'google assistant'
	]

	for assistant in assistants:
		if string.find(assistant) != -1:
			return utils.output('end', 'success', utils.translate(assistant.replace(' ', '_')))

	return utils.output('end', 'unknown', utils.translate('unknown'))
