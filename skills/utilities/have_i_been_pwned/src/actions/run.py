#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from time import sleep
from urllib import parse
from requests import codes, exceptions

# Developer token
api_key = utils.config('credentials')['api_key']

def run(params):
    """Verify if one or several email addresses have been pwned"""

    emails = []

    for item in params['entities']:
        if item['entity'] == 'email':
            emails.append(item['resolution']['value'])

    if not emails:
        emails = utils.config('options')['emails']

        if not emails:
            return utils.output('end', 'no_email')

    utils.output('inter', 'checking')

    for index, email in enumerate(emails):
        is_last_email = index == len(emails) - 1
        breached = check_for_breach(email)
        data = { 'email': email }

        # Have I Been Pwned API returns a 403 when accessed by unauthorized/banned clients
        if breached == 403:
        	return utils.output('end', { 'key': 'blocked',
				'data': {
					'website_name': 'Have I Been Pwned'
				}
			})
        elif breached == 503:
        	return utils.output('end', { 'key': 'unavailable',
				'data': {
					'website_name': 'Have I Been Pwned'
				}
			})
        elif not breached:
            if is_last_email:
            	return utils.output('end', { 'key': 'no_pwnage', 'data': data })
            else:
            	utils.output('inter', { 'key': 'no_pwnage', 'data': data })
        else:
            data['result'] = ''

            for index, b in enumerate(breached):
                data['result'] += utils.translate('list_element', {
                        'url': 'http://' + b['Domain'],
                        'name': b['Name'],
                        'total': b['PwnCount']
                    }
                )

            if is_last_email:
            	return utils.output('end', { 'key': 'pwned', 'data': data })
            else:
            	utils.output('inter', { 'key': 'pwned', 'data': data })
def check_for_breach(email):
    # Delay for 2 seconds before making request to accomodate API usage policy
    sleep(2)
    truncate = '?truncateResponse=true'
    url = 'https://haveibeenpwned.com/api/v3/breachedaccount/' + parse.quote_plus(email)

    try:
        response = utils.http('GET', url, { 'hibp-api-key': api_key })

        if response.status_code == 404:
            return None
        elif response.status_code == 200:
            return response.json()

        return response.status_code
    except exceptions.RequestException as e:
    	return utils.output('end', { 'key': 'errors',
			'data': {
				'website_name': 'Have I Been Pwned'
			}
		})
