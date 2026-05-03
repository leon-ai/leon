from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory


def run(params: ActionParams) -> None:
    """Save name and birthdate into Leon's memory"""
    action_arguments = params.get('action_arguments', {})
    owner_name = action_arguments.get('owner_name')
    owner_birth_date = action_arguments.get('owner_birth_date')

    if not isinstance(owner_name, str) or not isinstance(owner_birth_date, str):
        leon.answer({
            'core': {
                'should_stop_skill': True
            }
        })
        return

    owner: memory.Owner = {
        'name': owner_name,
        'birth_date': owner_birth_date
    }
    memory.upsert_owner(owner)

    leon.answer({
        'key': 'remembered',
        'data': {
            'owner_name': owner_name
        }
    })
