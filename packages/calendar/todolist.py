#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
from time import time

# Package database
db = utils.db()['db']

# Lists of the module table
db_lists = db.table('todo_lists')
# Todos of the module table
db_todos = db.table('todo_todos')

# Query
Query = utils.db()['query']()

# Time stamp
timestamp = int(time())

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

def view_lists(string, entities):
	"""View to-do lists"""

	# Lists number
	lists_nb = len(db_lists)

	# Verify if a list exists
	if lists_nb == 0:
		return utils.output('end', 'no_list', utils.translate('no_list'))

	result = ''
	# Fill end-result
	for listelement in db_lists:
		result += utils.translate('list_list_element', {
			'list': listelement['name'],
			'todos_nb': db_todos.count(Query.list == listelement['name'])
		})

	return utils.output('end', 'lists_listed', utils.translate('lists_listed', {
				'lists_nb': lists_nb,
				'result': result
			}
		)
	)

def view_list(string, entities):
	"""View a to-do list"""

	# List name
	listname = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			listname = item['sourceText'].lower()

	# Verify if the list exists
	if db_lists.count(Query.name == listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': listname }))

	# Grab todos of the list
	todos = db_todos.search(Query.list == listname)

	if len(todos) == 0:
		return utils.output('end', 'empty_list', utils.translate('empty_list', { 'list': listname }))

	unchecked_todos = db_todos.search((Query.list == listname) & (Query.is_completed == False))
	completed_todos = db_todos.search((Query.list == listname) & (Query.is_completed == True))

	result_unchecked_todos = ''
	result_completed_todos = ''

	if len(unchecked_todos) == 0:
		utils.output('inter', 'no_unchecked_todo', utils.translate('no_unchecked_todo', { 'list': listname }))
	else:
		for todo in unchecked_todos:
			result_unchecked_todos += utils.translate('list_todo_element', {
				'todo': todo['name']
			})

		utils.output('inter', 'unchecked_todos_listed', utils.translate('unchecked_todos_listed', {
					'list': listname,
					'result': result_unchecked_todos
				}
			)
		)

	if len(completed_todos) == 0:
		return utils.output('end', 'no_completed_todo', utils.translate('no_completed_todo', { 'list': listname }))

	for todo in completed_todos:
		result_completed_todos += utils.translate('list_completed_todo_element', {
			'todo': todo['name']
		})

	return utils.output('end', 'completed_todos_listed', utils.translate('completed_todos_listed', {
				'list': listname,
				'result': result_completed_todos
			}
		)
	)

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
		dbCreateList(listname)

	result = ''
	for todo in todos:
		# Add to-do to DB
		dbCreateTodo(listname, todo)
		result += utils.translate('list_todo_element', { 'todo': todo })

	return utils.output('end', 'todos_added', utils.translate('todos_added', {
	  'list': listname,
	  'result': result
	}))

def complete_todos(string, entities):
	"""Complete todos"""

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
		dbCreateList(listname)

	result = ''
	for todo in todos:
		for db_todo in db_todos.search(Query.list == listname):
			# Rough matching (e.g. 1kg of rice = rice)
			if db_todo['name'].find(todo) != -1:
				db_todos.update({
					'is_completed': True,
					'updated_at': timestamp
				}, (Query.list == listname) & (Query.name == db_todo['name']))

				result += utils.translate('list_completed_todo_element', { 'todo': db_todo['name'] })

	return utils.output('end', 'todos_completed', utils.translate('todos_completed', {
	  'list': listname,
	  'result': result
	}))

def uncheck_todos(string, entities):
	"""Uncheck todos"""

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

	# Verify if the list exists
	if db_lists.count(Query.name == listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': listname }))

	result = ''
	for todo in todos:
		for db_todo in db_todos.search(Query.list == listname):
			# Rough matching (e.g. 1kg of rice = rice)
			if db_todo['name'].find(todo) != -1:
				db_todos.update({
					'is_completed': False,
					'updated_at': timestamp
				}, (Query.list == listname) & (Query.name == db_todo['name']))

				result += utils.translate('list_todo_element', { 'todo': db_todo['name'] })

	return utils.output('end', 'todo_unchecked', utils.translate('todos_unchecked', {
	  'list': listname,
	  'result': result
	}))

def dbCreateList(listname):
	"""Create list in DB"""

	db_lists.insert({
		'name': listname,
		'created_at': timestamp,
		'updated_at': timestamp
	})

def dbCreateTodo(listname, todoname):
	"""Create to-todo in list DB table"""

	db_todos.insert({
		'list': listname,
		'name': todoname,
		'is_completed': False,
		'created_at': timestamp,
		'updated_at': timestamp
	})