from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network

from ..lib import github_lang
from re import search, escape
from bs4 import BeautifulSoup


def run(params: ActionParams) -> None:
    """Get the GitHub trends"""

    # Number of repositories
    limit: int = 5

    # Range string
    since: str = 'daily'

    # Technology slug
    tech_slug: str = ''

    # Technology name
    tech: str = ''

    # Answer key
    answer_key: str = 'today'

    for item in params['entities']:
        if item['entity'] == 'number':
            limit = item['resolution']['value']
        if item['entity'] == 'daterange':
            if item['resolution']['timex'].find('W') != -1:
                since = 'weekly'
                answer_key = 'week'
            else:
                since = 'monthly'
                answer_key = 'month'

    # Feed the languages list based on the GitHub languages list
    for i, language in enumerate(github_lang.get_all()):
        # Find the asked language
        if search(r'\b' + escape(language.lower()) + r'\b', params['utterance'].lower()):
            answer_key += '_with_tech'
            tech = language
            tech_slug = language.lower()

    if limit > 25:
        leon.answer({
            'key': 'limit_max',
            'data': {
                'limit': limit
            }
        })
        limit = 25
    elif limit == 0:
        limit = 5

    leon.answer({'key': 'reaching'})

    network = Network({'base_url': 'https://github.com'})
    try:
        response = network.request({
            'url': f'/trending/{tech_slug}?since={since}',
            'method': 'GET'
        })
        soup = BeautifulSoup(response['data'], features='html.parser')
        elements = soup.select('article.Box-row', limit=limit)
        result: str = ''

        for i, element in enumerate(elements):

            repository: str = '?'
            if element.h2 is not None:
                repository = element.h2.get_text(strip=True).replace(' ', '')

            author: str = '?'
            if element.img is not None:
                image_alt = element.img.get('alt')
                if isinstance(image_alt, str):
                    author = image_alt[1:]

            has_stars = element.select('span.d-inline-block.float-sm-right')
            stars = 0

            if has_stars:
                stars = element.select('span.d-inline-block.float-sm-right')[0].get_text(strip=True).split(' ')[0]
                separators = [' ', ',', '.']

                # Replace potential separators number
                for j, separator in enumerate(separators):
                    stars = stars.replace(separator, '')

            result += str(leon.set_answer_data('list_element', {
                'rank': i + 1,
                'repository_url': f'https://github.com/{repository}',
                'repository_name': repository,
                'author_url': f'https://github.com/{author}',
                'author_username': author,
                'stars_nb': stars
            }))

        return leon.answer({
            'key': answer_key,
            'data': {
                'limit': limit,
                'tech': tech,
                'result': result
            }
        })
    except Exception as e:
        return leon.answer({'key': 'unreachable'})
