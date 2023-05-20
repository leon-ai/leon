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

    if current_question == 1:
        session_table.upsert(table.Document({
            'E': 0,
            'I': 0,
            'S': 0,
            'N': 0,
            'T': 0,
            'F': 0,
            'J': 0,
            'P': 0
        }, doc_id=0))


def increment_letter(letter):
    """Add one point to a letter"""

    letter_score = get_session()[letter] + 1

    session_table.update(table.Document({letter: letter_score}, doc_id=0))


def get_session():
    """Get current session"""

    return session_table.get(doc_id=0)
