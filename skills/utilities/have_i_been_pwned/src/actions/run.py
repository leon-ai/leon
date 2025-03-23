from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network, NetworkError
from bridges.python.src.sdk.settings import Settings

from time import sleep

# Developer token
settings = Settings()
api_key: str = settings.get('api_key')


def run(params: ActionParams) -> None:
    """Verify if one or several email addresses have been pwned"""

    emails: list[str] = []

    for item in params['current_entities']:
        if item['entity'] == 'email':
            emails.append(item['resolution']['value'])

    if len(emails) == 0:
        emails = settings.get('emails')

        if len(emails) == 0:
            return leon.answer({'key': 'no_email'})

    for email in emails:
        leon.answer({'key': 'checking'})
        # Delay for 5 seconds before making request to accommodate API usage policy
        sleep(5)
        try:
            network = Network({
                'base_url': 'https://haveibeenpwned.com/api/v3'
            })
            response = network.request({
                'url': f'/breachedaccount/{email}?truncateResponse=false',
                'method': 'GET',
                'headers': {
                    'hibp-api-key': api_key
                }
            })
            breaches = response['data']
            breached = len(breaches) > 0
            if breached:
                result: str = ''
                for breach in breaches:
                    result += str(leon.set_answer_data('list_element', {
                        'url': f'https://{breach["Domain"]}',
                        'name': breach['Name'],
                        'total': breach['PwnCount']
                    }))
                leon.answer({
                    'key': 'pwned',
                    'data': {
                        'email': email,
                        'result': result
                    }
                })
        except NetworkError as e:
            # Have I Been Pwned API returns a 403 when accessed by unauthorized/banned clients
            if e.response['status_code'] == 403:
                leon.answer({
                    'key': 'blocked',
                    'data': {
                        'website_name': 'Have I Been Pwned'
                    }
                })
            elif e.response['status_code'] == 404:
                leon.answer({
                    'key': 'no_pwnage',
                    'data': {
                        'email': email
                    }
                })
            elif e.response['status_code'] == 503:
                leon.answer({
                    'key': 'unavailable',
                    'data': {
                        'website_name': 'Have I Been Pwned'
                    }
                })
            else:
                leon.answer({
                    'key': 'errors',
                    'data': {
                        'website_name': 'Have I Been Pwned'
                    }
                })
