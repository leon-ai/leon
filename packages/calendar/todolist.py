#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils

def create_list(string, entities):
	"""WIP"""

	return utils.output('end', 'list_created', utils.translate('list_created', { 'list': 'test' }))

def add_todo(string, entities):
	"""WIP"""

	return utils.output('end', 'todo_added', utils.translate('todo_added', {
	  'list': 'test',
	  'todo': 'todo 1'
	}))

def delete_todo(string, entities):
	"""WIP"""

	return utils.output('end', 'todo_deleted', utils.translate('todo_deleted', {
	  'list': 'test',
	  'todo': 'todo 1'
	}))
