#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib.db import db_create_list

# Skill database
db = utils.db()['db']

# Todo lists table
db_lists = db.table('todo_lists')

# Query
Query = utils.db()['query']()

# Time stamp
timestamp = int(time())

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
	if db_lists.count(Query.name == list_name) > 0:
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': list_name }))

	db_create_list(db_lists, {
		'list_name': list_name,
		'timestamp': timestamp
	})

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': list_name }))
