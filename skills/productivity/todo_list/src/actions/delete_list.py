#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib.db import db_create_list

# Skill database
db = utils.db()['db']

# Todo lists table
db_lists = db.table('todo_lists')
# Todos of the module table
db_todos = db.table('todo_todos')

# Query
Query = utils.db()['query']()

def delete_list(string, entities):
	"""Delete a to-do list"""

	# List name
	listname = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			listname = item['sourceText'].lower()

	# Verify if a list name has been provided
	if not listname:
		return utils.output('end', 'list_not_provided', utils.translate('list_not_provided'))

	# Verify if the list exists
	if db_lists.count(Query.name == listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': listname }))

	# Delete the to-do list
	db_lists.remove(Query.name == listname)
	# Delete todos of that to-do list
	db_todos.remove(Query.list == listname)

	return utils.output('end', 'list_deleted', utils.translate('list_deleted', { 'list': listname }))
