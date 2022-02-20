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

def complete_todos(string, entities):
	"""Complete todos"""

	# List name
	list_name = ''

	# Todos
	todos = []

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			list_name = item['sourceText'].lower()
		elif item['entity'] == 'todos':
			# Split todos into array and trim start/end-whitespaces
			todos = [chunk.strip() for chunk in item['sourceText'].lower().split(',')]

	# Verify if a list name has been provided
	if not list_name:
		return utils.output('end', 'list_not_provided', utils.translate('list_not_provided'))

	# Verify todos have been provided
	if len(todos) == 0:
		return utils.output('end', 'todos_not_provided', utils.translate('todos_not_provided'))

	# Verify the list exists
	if db_lists.count(Query.name == list_name) == 0:
		# Create the new to-do list
		db_create_list(db_lists, {
			'list_name': list_name
		})

	result = ''
	for todo in todos:
		for db_todo in db_todos.search(Query.list == list_name):
			# Rough matching (e.g. 1kg of rice = rice)
			if db_todo['name'].find(todo) != -1:
				db_todos.update({
					'is_completed': True
				}, (Query.list == list_name) & (Query.name == db_todo['name']))

				result += utils.translate('list_completed_todo_element', { 'todo': db_todo['name'] })

	return utils.output('end', 'todos_completed', utils.translate('todos_completed', {
	  'list': list_name,
	  'result': result
	}))
