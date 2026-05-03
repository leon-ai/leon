from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network

from typing import Union, Literal


def run(params: ActionParams) -> None:
    """Check if a website is down or not"""

    domains: list[str] = []
    action_arguments = params.get('action_arguments', {})
    domain = action_arguments.get('domain')
    if isinstance(domain, str) and len(domain) > 0:
        normalized_domain = domain.lower().strip()
        normalized_domain = normalized_domain.replace('https://', '').replace('http://', '')
        normalized_domain = normalized_domain.rstrip('/')
        domains.append(normalized_domain)

    if len(domains) == 0:
        leon.answer({
            'key': 'invalid_domain_name',
            'data': {
                'website_name': 'this domain'
            }
        })
        return

    network = Network()

    for domain in domains:
        state: Union[Literal['up'], Literal['down']] = 'up'
        website_name = domain[:domain.find('.')].title()

        leon.answer({
            'key': 'checking',
            'data': {
                'website_name': website_name
            }
        })

        try:
            network.request({
                'url': 'https://' + domain,
                'method': 'GET'
            })
            state = 'up'
        except Exception as e:
            if network.is_network_error(e):
                state = 'down'
            else:
                leon.answer({
                    'key': 'errors',
                    'data': {
                        'website_name': website_name
                    }
                })
                continue

        leon.answer({
            'key': state,
            'data': {
                'website_name': website_name
            }
        })
