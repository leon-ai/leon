from time import time

import utils
from ..lib import db


def delete_list(params):
    """Delete a to-do list"""

    # List name
    list_name = ''

    # Find entities
    for item in params['entities']:
        if item['entity'] == 'list':
            list_name = item['sourceText'].lower()

    # Verify if a list name has been provided
    if not list_name:
        return utils.output('end', 'list_not_provided')

    # Verify if the list exists
    if db.has_list(list_name) == False:
        return utils.output('end', {
            'key': 'list_does_not_exist',
            'data': {
                'list': list_name
            }
        })

    # Delete the to-do list
    db.delete_list(list_name)

    return utils.output('end', {
        'key': 'list_deleted',
        'data': {
            'list': list_name
        }
    })
