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

def add_todos(string, entities):
	"""Add todos to a to-do list"""

	# List name
	listname = ''

	# Todos
	todos = []

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			listname = item['sourceText'].lower()
		elif item['entity'] == 'todos':
			# Split todos into array and trim start/end-whitespaces
			todos = [chunk.strip() for chunk in item['sourceText'].lower().split(',')]

	# Verify if a list name has been provided
	if not listname:
		return utils.output('end', 'list_not_provided', utils.translate('list_not_provided'))

	# Verify todos have been provided
	if len(todos) == 0:
		return utils.output('end', 'todos_not_provided', utils.translate('todos_not_provided'))

	# Verify the list exists
	if db_lists.count(Query.name == listname) == 0:
		# Create the new to-do list
		db_create_list(listname)

	result = ''
	for todo in todos:
		# Add to-do to DB
		db_create_todo(listname, todo)
		result += utils.translate('list_todo_element', { 'todo': todo })

	return utils.output('end', 'todos_added', utils.translate('todos_added', {
	  'list': listname,
	  'result': result
	}))
