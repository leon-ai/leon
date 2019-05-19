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

	# Create the new to-do list
	lists.insert({
		'name': listname,
		'todos': [],
		'created_at': int(time())
	})

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': listname }))

def rename_list(string, entities):
	"""WIP"""

	return utils.output('end', 'list_renamed', utils.translate('list_renamed', {
	  'old_list': 'fake',
	  'new_list': 'new'
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

def complete_todo(string, entities):
	"""WIP"""

	return utils.output('end', 'todo_completed', utils.translate('todo_completed', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))

def archive_todo(string, entities):
	"""WIP"""

	return utils.output('end', 'todo_archived', utils.translate('todo_archived', {
	  'list': 'fake',
	  'todo': 'todo 1'
	}))
