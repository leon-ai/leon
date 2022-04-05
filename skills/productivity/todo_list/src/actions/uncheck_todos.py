#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib import db

def uncheck_todos(params):
	"""Uncheck todos"""

	# List name
	list_name = ''

	# Todos
	todos = []

	# Find entities
	for item in params['entities']:
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

	# Verify if the list exists
	if db.has_list(list_name) == False:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': list_name }))

	result = ''
	for todo in todos:
		for db_todo in db.get_todos(list_name):
			# Rough matching (e.g. 1kg of rice = rice)
			if db_todo['name'].find(todo) != -1:
				db.uncomplete_todo(list_name, db_todo['name'])

				result += utils.translate('list_todo_element', { 'todo': db_todo['name'] })

	return utils.output('end', 'todo_unchecked', utils.translate('todos_unchecked', {
	  'list': list_name,
	  'result': result
	}))
