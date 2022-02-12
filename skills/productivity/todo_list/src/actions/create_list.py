#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

# Package database
db = utils.db()['db']

# Lists of the module table
db_lists = db.table('todo_lists')

# Query
Query = utils.db()['query']()

def create_list(string, entities):
	"""Create a to-do list"""

	# List name
	listname = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			listname = item['sourceText'].lower()

	# Verify if a list name has been provided
	if not listname:
		return utils.output('end', 'list_not_provided', utils.translate('list_not_provided'))

	# Verify if list already exists or not
	if db_lists.count(Query.name == listname) > 0:
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': listname }))

	dbCreateList(listname)

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': listname }))
