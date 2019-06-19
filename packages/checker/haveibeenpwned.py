#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from time import sleep
from urllib import parse
from requests import codes, exceptions

def run(string, entities):
    """Verify if one or several email addresses have been pwned"""
    
    emails = []
      
    for item in entities:
        if item['entity'] == 'email':
            emails.append(item['resolution']['value'])

    if not emails:
        emails = utils.config('emails')

        if not emails:
            return utils.output('end', 'no-email', utils.translate('no-email'))

    utils.output('inter', 'checking', utils.translate('checking'))

    for index, email in enumerate(emails):
        isLastEmail = index == len(emails) - 1
        breached = checkForBreach(email)
        data = { 'email': email }

        # Have I Been Pwned API returns a 403 when accessed by unauthorized/banned clients
        if breached == 403:
            return utils.output('end', 'blocked', utils.translate('blocked', { 'website_name': 'Have I Been Pwned' }))
        elif breached == 503:
            return utils.output('end', 'blocked', utils.translate('unavailable', { 'website_name': 'Have I Been Pwned' }))
        elif not breached:
            if isLastEmail:
                return utils.output('end', 'no-pwnage', utils.translate('no-pwnage', data))
            else:
                utils.output('inter', 'no-pwnage', utils.translate('no-pwnage', data))
        else:
            data['result'] = ''

            for index, b in enumerate(breached):
                data['result'] += utils.translate('list_element', {
                        'url': 'http://' + b['Domain'],
                        'name': b['Name'],
                        'total': b['PwnCount']
                    }
                )

            if isLastEmail:
                return utils.output('end', 'pwned', utils.translate('pwned', data))
            else:
                utils.output('inter', 'pwned', utils.translate('pwned', data))

def checkForBreach(email):
    # Delay for 2 seconds before making request to accomodate API usage policy
    sleep(2)
    truncate = '?truncateResponse=true'
    url = 'https://haveibeenpwned.com/api/v2/breachedaccount/' + parse.quote_plus(email)

    try:
        response = utils.http('GET', url)

        if response.status_code == 404:
            return None
        elif response.status_code == 200:
            return response.json()

        return response.status_code
    except exceptions.RequestException as e:
        return utils.output('end', 'down', utils.translate('errors', { 'website_name': 'Have I Been Pwned' }))
