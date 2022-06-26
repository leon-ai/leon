from time import time

import utils

# Skill database
db = utils.db()['db']

# Todo lists table
db_lists = db.table('todo_lists')
# Todos of the module table
db_todos = db.table('todo_todos')

# Query
Query = utils.db()['query']()

# Time stamp
timestamp = int(time())

def create_list(list_name):
	"""Create list in DB"""

	db_lists.insert({
		'name': list_name,
		'created_at': timestamp,
		'updated_at': timestamp
	})

def get_lists():
	"""Get lists"""

	return db_lists

def update_list_name(old_list_name, new_list_name):
	"""Update list name in DB"""

	db_lists.update({
		'name': new_list_name,
		'updated_at': timestamp
	}, Query.name == old_list_name)

def delete_list(list_name):
	"""Delete list and its todos"""

	db_lists.remove(Query.name == list_name)
	db_todos.remove(Query.list == list_name)

def count_lists():
	"""Count number of lists"""

	return len(db_lists)

def has_list(list_name):
	"""Check if the list already exist"""

	return db_lists.count(Query.name == list_name) > 0

def create_todo(list_name, todo_name):
	"""Create to-todo in list DB table"""

	db_todos.insert({
		'list': list_name,
		'name': todo_name,
		'is_completed': False,
		'created_at': timestamp,
		'updated_at': timestamp
	})

def update_todo_list_name(old_list_name, new_list_name):
	"""Update todo list name in DB"""

	db_todos.update({
		'list': new_list_name,
		'updated_at': timestamp
	}, Query.list == old_list_name)

def count_todos(list_name):
	"""Count number of todos within a list"""

	return db_todos.count(Query.list == list_name)

def get_todos(list_name):
	"""Get todos of a list"""

	return db_todos.search(Query.list == list_name)

def get_done_todos(list_name):
	"""Get done todos of a list"""

	return db_todos.search((Query.list == list_name) & (Query.is_completed == True))

def get_uncomplete_todos(list_name):
	"""Get uncomplete todos of a list"""

	return db_todos.search((Query.list == list_name) & (Query.is_completed == False))

def complete_todo(list_name, todo_name):
	"""Mark a todo from a list as done"""

	db_todos.update({
		'is_completed': True
	}, (Query.list == list_name) & (Query.name == todo_name))

def uncomplete_todo(list_name, todo_name):
	"""Mark a todo from a list as uncomplete"""

	db_todos.update({
		'is_completed': False
	}, (Query.list == list_name) & (Query.name == todo_name))
