#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils

def create_list(string, entities):
	"""WIP"""

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': 'fake' }))

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
