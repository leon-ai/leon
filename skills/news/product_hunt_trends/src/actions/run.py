from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network
from bridges.python.src.sdk.settings import Settings

import sys


def run(params: ActionParams) -> None:
    """Get the Product Hunt trends"""

    # Developer token
    settings = Settings()
    if not settings.is_setting_set('developer_token'):
        return leon.answer({'key': 'invalid_developer_token'})
    developer_token: str = settings.get('developer_token')

    # Number of products
    limit: int = 5

    for item in params['entities']:
        if item['entity'] == 'number':
            limit = item['resolution']['value']

    leon.answer({'key': 'reaching'})

    network = Network({'base_url': 'https://api.producthunt.com/v2/api/graphql'})
    try:
        query = """
        query getPosts($first: Int!) {
            posts(first: $first) {
                edges {
                    node {
                        url
                        name
                        votesCount
                    }
                }
            }
        }
        """
        response = network.request({
            'url': '/',
            'method': 'POST',
            'headers': {
                'Authorization': f'Bearer {developer_token}'
            },
            'data': {
                'query': query,
                'variables': {
                    'first': limit
                }
            }
        })

        posts = response['data']['data']['posts']['edges']
        result = ''

        if len(posts) == 0:
            return leon.answer({'key': 'not_found'})

        for index, post in enumerate(posts):
            node = post['node']
            rank = index + 1
            result += str(leon.set_answer_data('list_element', {
                'rank': rank,
                'post_url': node['url'],
                'product_name': node['name'],
                'votes_nb': node['votesCount']
            }))

            if rank == limit:
                break

        return leon.answer({
            'key': 'today',
            'data': {
                'limit': limit,
                'result': result
            }
        })
    except Exception as e:
        print(e, flush=True, file=sys.stderr)
        return leon.answer({'key': 'unreachable'})
