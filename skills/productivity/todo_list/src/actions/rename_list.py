#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib import db

def rename_list(params):
	"""Rename a to-do list"""

	# Old list name
	old_list_name = ''

	# New list name
	new_list_name = ''

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'old_list':
			old_list_name = item['sourceText'].lower()
		elif item['entity'] == 'new_list':
			new_list_name = item['sourceText'].lower()

	# Verify if an old and new list name have been provided
	if not old_list_name or not new_list_name:
		return utils.output('end', 'new_or_old_list_not_provided')

	# Verify if the old list exists
	if db.has_list(old_list_name) == False:
		return utils.output('end', { 'key': 'list_does_not_exist',
			'data': {
				'list': old_list_name
			}
		})

	# Verify if the new list name already exists
	if db.has_list(new_list_name):
		return utils.output('end', { 'key': 'list_already_exists',
			'data': {
				'list': new_list_name
			}
		})

	# Rename the to-do list
	db.update_list_name(old_list_name, new_list_name)
	# Rename the list name of the todos
	db.update_todo_list_name(old_list_name, new_list_name)

	return utils.output('end', { 'key': 'list_renamed',
		'data': {
			'old_list': old_list_name,
			'new_list': new_list_name
		}
	})
