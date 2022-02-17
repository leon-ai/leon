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

def rename_list(string, entities):
	"""Rename a to-do list"""

	# Old list name
	old_listname = ''

	# New list name
	new_listname = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'old_list':
			old_listname = item['sourceText'].lower()
		elif item['entity'] == 'new_list':
			new_listname = item['sourceText'].lower()

	# Verify if an old and new list name have been provided
	if not old_listname or not new_listname:
		return utils.output('end', 'new_or_old_list_not_provided', utils.translate('new_or_old_list_not_provided'))

	# Verify if the old list exists
	if db_lists.count(Query.name == old_listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': old_listname }))

	# Verify if the new list name already exists
	if db_lists.count(Query.name == new_listname) > 0:
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': new_listname }))

	# Rename the to-do list
	db_lists.update({
		'name': new_listname,
		'updated_at': int(time())
	}, Query.name == old_listname)
	# Rename the list name of the todos
	db_todos.update({
		'list': new_listname,
		'updated_at': int(time())
	}, Query.list == old_listname)

	return utils.output('end', 'list_renamed', utils.translate('list_renamed', {
	  'old_list': old_listname,
	  'new_list': new_listname
	}))
