#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils


def run(params):
    """Check if a website is down or not"""

    domains = []
    output = ''

    # Find entities from the current utterance
    for item in params['current_entities']:
        if item['entity'] == 'url':
            domains.append(item['resolution']['value'].lower())

    if len(domains) == 0:
        # Find entities from the context
        for item in params['entities']:
            if item['entity'] == 'url':
                domains.append(item['resolution']['value'].lower())

    for i, domain in enumerate(domains):
        state = 'up'
        website_name = domain[:domain.find('.')].title()

        utils.output('inter', {
            'key': 'checking',
            'data': {
                'website_name': website_name
            }
        })

        try:
            r = utils.http('GET', 'http://' + domain)

            if (r.status_code != requests.codes.ok):
                state = 'down'

            utils.output('inter', {
                'key': state,
                'data': {
                    'website_name': website_name
                }
            })
        except requests.exceptions.RequestException as e:
            utils.output('inter', {
                'key': 'errors',
                'data': {
                    'website_name': website_name
                }
            })

        if len(domains) > 1 and i >= 0 and i + 1 < len(domains):
            output += ' '

    if len(domains) == 0:
        return utils.output('end', {
            'key': 'invalid_domain_name',
            'data': {
                'website_name': website_name
            }
        })

    return utils.output('end')
