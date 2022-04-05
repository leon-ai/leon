#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib import db

def view_list(params):
	"""View a to-do list"""

	# List name
	list_name = ''

	# Find entities
	for item in params['entities']:
		if item['entity'] == 'list':
			list_name = item['sourceText'].lower()

	# Verify if the list exists
	if db.has_list(list_name) == False:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': list_name }))

	# Grab todos of the list
	todos = db.get_todos(list_name)

	if len(todos) == 0:
		return utils.output('end', 'empty_list', utils.translate('empty_list', { 'list': list_name }))

	unchecked_todos = db.get_uncomplete_todos(list_name)
	completed_todos = db.get_done_todos(list_name)

	result_unchecked_todos = ''
	result_completed_todos = ''

	if len(unchecked_todos) == 0:
		utils.output('inter', 'no_unchecked_todo', utils.translate('no_unchecked_todo', { 'list': list_name }))
	else:
		for todo in unchecked_todos:
			result_unchecked_todos += utils.translate('list_todo_element', {
				'todo': todo['name']
			})

		utils.output('inter', 'unchecked_todos_listed', utils.translate('unchecked_todos_listed', {
					'list': list_name,
					'result': result_unchecked_todos
				}
			)
		)

	if len(completed_todos) == 0:
		return utils.output('end', 'no_completed_todo', utils.translate('no_completed_todo', { 'list': list_name }))

	for todo in completed_todos:
		result_completed_todos += utils.translate('list_completed_todo_element', {
			'todo': todo['name']
		})

	return utils.output('end', 'completed_todos_listed', utils.translate('completed_todos_listed', {
				'list': list_name,
				'result': result_completed_todos
			}
		)
	)
