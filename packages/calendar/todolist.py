#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
from time import time

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

	timestamp = int(time())
	# Create the new to-do list
	lists.insert({
		'name': listname,
		'todos': [],
		'created_at': timestamp,
		'updated_at': timestamp
	})

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': listname }))

def view_lists(string, entities):
	"""View to-do lists"""

	# Lists number
	lists_nb = len(lists)

	# Verify if a list exists
	if lists_nb == 0:
		return utils.output('end', 'no_list', utils.translate('no_list'))

	result = ''
	# Fill end result
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

	# Verify the list exists
	if lists.count(List.name == listname) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': listname }))

	# Verify todos have been provided
	if len(todos) == 0:
		return utils.output('end', 'todos_not_provided', utils.translate('todos_not_provided'))

	# Grab existing todos of the list
	existing_todos = lists.get(List.name == listname)['todos']

	# Add todos to the to-do list
	lists.update({
		'todos': todos + existing_todos,
		'updated_at': int(time())
	}, List.name == listname)

	result = ''
	# Fill end result
	for todo in todos:
		result += utils.translate('list_todo_element', { 'todo': todo })

	return utils.output('end', 'todos_added', utils.translate('todos_added', {
	  'list': listname,
	  'result': result
	}))

def view_todos(string, entities):
	"""WIP"""

	# TODO

def uncomplete_todos(string, entities):
	"""WIP"""

	# Complete potatoes from my list
	# TODO: look in all lists first, if several then ask to specify from which list
	# Complete potatoes from the shopping list

	return utils.output('end', 'todo_uncompleted', utils.translate('todo_uncompleted', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))

def complete_todos(string, entities):
	"""WIP"""

	# Complete potatoes from my list
	# TODO: look in all lists first, if several then ask to specify from which list
	# Complete potatoes from the shopping list

	return utils.output('end', 'todo_completed', utils.translate('todo_completed', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))
