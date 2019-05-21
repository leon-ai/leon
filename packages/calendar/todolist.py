#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
from time import time
from tinydb import where

# Package database
db = utils.db()['db']

# Lists of the module table
lists = db.table('todo_lists')

# Query
List = utils.db()['query']()

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
	if lists.count(List.name == listname) > 0:
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': listname }))

	dbCreateList(listname)

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': listname }))

def view_lists(string, entities):
	"""View to-do lists"""

	# Lists number
	lists_nb = len(lists)

	# Verify if a list exists
	if lists_nb == 0:
		return utils.output('end', 'no_list', utils.translate('no_list'))

	result = ''
	# Fill end-result
	for listelement in lists:
		result += utils.translate('list_list_element', {
			'list': listelement['name'],
			'todos_nb': len(listelement['todos'])
		})

	return utils.output('end', 'lists_listed', utils.translate('list_list', {
				'lists_nb': lists_nb,
				'result': result
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
	if lists.count(List.name == old_listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': old_listname }))

	# Verify if the new list name already exists
	if lists.count(List.name == new_listname) > 0:
		return utils.output('end', 'list_already_exists', utils.translate('list_already_exists', { 'list': new_listname }))

	# Rename the to-do list
	lists.update({
		'name': new_listname,
		'updated_at': int(time())
	}, List.name == old_listname)

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
	if lists.count(List.name == listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': listname }))

	# Delete the to-do list
	lists.remove(List.name == listname)

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

	# Grab list
	db_list = lists.get(List.name == listname)
	existing_todos = []

	# Verify the list exists
	if db_list == None:
		# Create the new to-do list
		dbCreateList(listname)
	else:
		existing_todos = lists.get(List.name == listname)['todos']

	result = ''
	# Transform todo to a dict for DB and fill end-result
	for i, todo in enumerate(todos):
		todo = { 'name': todo, 'is_completed': False }
		todos[i] = todo
		result += utils.translate('list_todo_element', { 'todo': todo['name'] })

	# Add todos to the to-do list
	lists.update({
		'todos': todos + existing_todos,
		'updated_at': int(time())
	}, List.name == listname)

	return utils.output('end', 'todos_added', utils.translate('todos_added', {
	  'list': listname,
	  'result': result
	}))

def complete_todos(string, entities):
	"""Complete todos"""

	"""WIP"""

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

	# Grab list
	db_list = lists.get(List.name == listname)
	existing_todos = []

	# Verify the list exists
	if db_list == None:
		# Create the new to-do list
		dbCreateList(listname)
	else:
		existing_todos = lists.get(List.name == listname)['todos']

	result = ''
	updated_todos = []
	tmp_todos = []
	db_todos = lists.get(List.name == listname)['todos']

	# Is there todos in the list
	if len(db_todos) == 0:
		updated_todos.append({ 'name': todo, 'is_completed': True })

		for todo in todos:
			result += utils.translate('list_todo_element', { 'todo': todo })
	else:
		for todo in todos:
			for db_todo in db_todos:
				# Rough matching (e.g. 1kg of rice = rice)
				if db_todo['name'].find(todo) != -1:
					updated_todos.append(db_todo['name'])
				elif todo not in tmp_todos:
					tmp_todos.append(todo)

		for updated_todo in updated_todos:
			for tmp_todo in tmp_todos:
				if updated_todo.find(tmp_todo) != -1:
					tmp_todos.remove(tmp_todo)
				elif tmp_todo not in updated_todos:
					updated_todos.append(tmp_todo)

		# Set DB existing todos
		for db_todo in db_todos:
			if db_todo['name'] not in updated_todos:
				updated_todos.append(db_todo)

		for i, updated_todo in enumerate(updated_todos):
			if type(updated_todo) == str:
				updated_todos[i] = { 'name': updated_todo, 'is_completed': True }
				result += utils.translate('list_todo_element', { 'todo': updated_todo })

	return utils.output('end', 'todos_completed', utils.translate('todos_completed', {
	  'list': listname,
	  'result': result
	}))
	# Update todos
	# lists.update({
	# 	'todos': updated_todos,
	# 	'updated_at': int(time())
	# }, List.name == listname)

	# 	# Verify same word in todo. Allow to not give the exact same todo (e.g. 1kg of rice = rice)
	# 	if db_todo['name'].find(todo) != -1:

	# result += utils.translate('list_todo_element', { 'todo': db_todo['name'] })

	# Complete todos
	# lists.update({
	# 	'todos': updated_todos,
	# 	'updated_at': int(time())
	# }, List.name == listname)

	# return utils.output('end', 'todos_completed', utils.translate('todos_completed', {
	#   'list': listname,
	#   'result': result
	# }))

	# Complete potatoes from my list
	# TODO: look in all lists first, if several then ask to specify from which list
	# Complete potatoes from the shopping list

def uncomplete_todos(string, entities):
	"""WIP"""

	# Complete potatoes from my list
	# TODO: look in all lists first, if several then ask to specify from which list
	# Complete potatoes from the shopping list

	return utils.output('end', 'todo_uncompleted', utils.translate('todo_uncompleted', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))

def view_todos(string, entities):
	"""WIP"""

	# TODO

def dbCreateList(listname):
	"""Create list in DB"""

	timestamp = int(time())

	lists.insert({
		'name': listname,
		'todos': [],
		'created_at': timestamp,
		'updated_at': timestamp
	})