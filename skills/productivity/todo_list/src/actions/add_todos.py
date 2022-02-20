#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib import db

def add_todos(string, entities):
	"""Add todos to a to-do list"""

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
	if db.has_list(list_name) == False:
		# Create the new to-do list
		db.create_list(list_name)

	result = ''
	for todo in todos:
		# Add to-do to DB
		db.create_todo(list_name, todo)
		result += utils.translate('list_todo_element', { 'todo': todo })

	return utils.output('end', 'todos_added', utils.translate('todos_added', {
	  'list': list_name,
	  'result': result
	}))
