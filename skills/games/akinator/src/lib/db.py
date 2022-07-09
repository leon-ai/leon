from time import time

import utils

# Skill database
db = utils.db()['db']

# Session table
session_table = db.table('session')

# Time stamp
timestamp = int(time())

def create_new_session(session):
	"""Creation new session"""

	session_table.insert(session)

def get_new_session():
	"""Get the newly created session"""


	return session_table.all()[-1]
