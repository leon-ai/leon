from time import time

import utils

# Skill database
db = utils.db()['db']

table = utils.db()['table']

# Owner table
owner_table = db.table('owner')

# Time stamp
timestamp = int(time())

def upsert_owner(owner_name, owner_birth_date):
	"""Save basic information about the owner"""

	owner_table.upsert(table.Document({
		'name': owner_name,
		'birth_date': owner_birth_date
	}, doc_id=0))

def get_owner():
	"""Get owner's basic information"""

	return owner_table.get(doc_id=0)
