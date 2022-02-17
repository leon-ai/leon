#!/usr/bin/env python
# -*- coding:utf-8 -*-

from time import time

import utils
from ..lib.db import db_create_list

# Skill database
db = utils.db()['db']

# Todo lists table
db_lists = db.table('todo_lists')
# Todos of the module table
db_todos = db.table('todo_todos')

# Query
Query = utils.db()['query']()

def view_lists(string, entities):
	"""View to-do lists"""

	# Lists number
	lists_nb = len(db_lists)

	# Verify if a list exists
	if lists_nb == 0:
		return utils.output('end', 'no_list', utils.translate('no_list'))

	result = ''
	# Fill end-result
	for list_element in db_lists:
		result += utils.translate('list_list_element', {
			'list': list_element['name'],
			'todos_nb': db_todos.count(Query.list == list_element['name'])
		})

	return utils.output('end', 'lists_listed', utils.translate('lists_listed', {
				'lists_nb': lists_nb,
				'result': result
			}
		)
	)
