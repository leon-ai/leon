from time import time

import utils

# Skill database
db = utils.db()['db']

table = utils.db()['table']

# Session table
session_table = db.table('session')

# Time stamp
timestamp = int(time())

def upsert_session(current_question):
	"""Save current question number"""

	session_table.upsert(table.Document({
		'current_question': current_question
	}, doc_id=0))

def get_session():
	"""TODO"""

	return session_table.get(doc_id=0)
