#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib import db

def create_list(string, entities):
	"""Create a to-do list"""

	# List name
	list_name = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			list_name = item['sourceText'].lower()

	# Verify if a list name has been provided
	if not list_name:
		return utils.output('end', 'list_not_provided', utils.translate('list_not_provided'))

	# Verify if list already exists or not
	if db.has_list(list_name):
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': list_name }))

	db.create_list(list_name)

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': list_name }))
