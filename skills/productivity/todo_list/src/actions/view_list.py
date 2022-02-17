#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib.db import db_create_list

# Skill database
db = utils.db()['db']

# Todo lists table
db_lists = db.table('todo_lists')

# Query
Query = utils.db()['query']()

def view_list(string, entities):
	"""View a to-do list"""

	# List name
	list_name = ''

	# Find entities
	for item in entities:
		if item['entity'] == 'list':
			list_name = item['sourceText'].lower()

	# Verify if the list exists
	if db_lists.count(Query.name == list_name) == 0:
		return utils.output('end', 'list_does_not_exist', utils.translate('list_does_not_exist', { 'list': list_name }))

	# Grab todos of the list
	todos = db_todos.search(Query.list == list_name)

	if len(todos) == 0:
		return utils.output('end', 'empty_list', utils.translate('empty_list', { 'list': list_name }))

	unchecked_todos = db_todos.search((Query.list == list_name) & (Query.is_completed == False))
	completed_todos = db_todos.search((Query.list == list_name) & (Query.is_completed == True))

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
