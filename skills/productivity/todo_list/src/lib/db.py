def db_create_list(db_lists, data):
	"""Create list in DB"""

	db_lists.insert({
		'name': data['list_name'],
		'created_at': data['timestamp'],
		'updated_at': data['timestamp']
	})

def db_create_todo(db_todos, data):
	"""Create to-todo in list DB table"""

	db_todos.insert({
		'list': data['list_name'],
		'name': data['todo_name'],
		'is_completed': False,
		'created_at': data['timestamp'],
		'updated_at': data['timestamp']
	})
