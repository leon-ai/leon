import utils

# Skill database
db = utils.db()['db']

table = utils.db()['table']

# Session table
session_table = db.table('session')


def upsert_session(session):
    """Save progress/info about the session"""

    session_table.upsert(table.Document(session, doc_id=0))


def get_session():
    """Get current session progress data"""

    return session_table.get(doc_id=0)
