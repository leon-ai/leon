# TODO: find better way to import SDK modules
from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.memory import Memory
from bridges.python.src.sdk.aurora.button import Button


def run(params):
    """TODO"""

    # TODO
    # network request
    # memory
    # install bs4 and grab it from skill

    ###

    other_skill_memory = Memory({
        'name': 'productivity:todo_list:db'
    })

    todo_lists = other_skill_memory.read()
    print('todo_lists', todo_lists)

    posts_memory = Memory({'name': 'posts', 'default_memory': []})
    posts_memory.write([
        {
            'id': 0,
            'title': 'Hello world',
            'content': 'This is a test post',
            'author': {
                'name': 'Louis'
            }
        },
        {
            'id': 1,
            'title': 'Hello world 2',
            'content': 'This is a test post 2',
            'author': {
                'name': 'Louis'
            }
        }
    ])
    posts = posts_memory.read()
    print('posts', posts)

    posts = posts_memory.write([
        *posts,
        {
            'id': 2,
            'title': 'Hello world 3',
            'content': 'This is a test post 3',
            'author': {
                'name': 'Louis'
            }
        }
    ])

    found_post = next((post for post in posts if post['id'] == 2), None)

    print('found_post', found_post)

    ###

    button = Button({'text': 'Hello world from action skill'})

    leon.answer({'widget': button})

    ###

    leon.answer({'key': 'test'})

    ###

    options = leon.get_src_config('options')
    leon.answer({
        'key': 'answer',
        'data': {
            'answer': options['test_config']
        }
    })

    ###

    leon.answer({'key': 'just a raw answer...'})
    leon.answer({'key': 'default'})
    leon.answer({'key': 'data_test', 'data': {'name': 'Louis'}})
