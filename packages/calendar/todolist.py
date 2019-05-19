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
			listname = item['sourceText']

	# Verify if a list name has been provided
	if not listname:
		return utils.output('end', 'list_name_not_provided', utils.translate('list_name_not_provided'))

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

	# TODO

def rename_list(string, entities):
	"""Rename a to-do list"""

	# Old list name
	old_listname = ''

	# New list name
	new_listname = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'old_list':
			old_listname = item['sourceText']
		elif item['entity'] == 'new_list':
			new_listname = item['sourceText']

	# Verify if an old and new list name have been provided
	if not old_listname or not new_listname:
		return utils.output('end', 'new_or_old_list_name_not_provided', utils.translate('new_or_old_list_name_not_provided'))

	# Verify if the old list exists
	if lists.count(List.name == old_listname) == 0:
		return utils.output('end', 'list_does_not_exists', utils.translate('list_does_not_exists', { 'list': old_listname }))

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
	"""WIP"""

	return utils.output('end', 'list_deleted', utils.translate('list_deleted', { 'list': 'fake' }))

def add_todo(string, entities):
	"""WIP"""

	return utils.output('end', 'todo_added', utils.translate('todo_added', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))

def view_todos(string, entities):
	"""WIP"""

	# TODO

def complete_todo(string, entities):
	"""WIP"""

	# Complete potatoes from my list
	# TODO: look in all lists first, if several then ask to specify from which list
	# Complete potatoes from the shopping list

	return utils.output('end', 'todo_completed', utils.translate('todo_completed', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))
