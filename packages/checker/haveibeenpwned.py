#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from time import sleep
from urllib import parse
from requests import codes, exceptions

def haveibeenpwned(string, entities):
    emails = []
    
    for item in entities:
        if item['entity'] == 'email':
            emails.append(item['resolution']['value'])
    
    if not emails:
        emails = utils.config('emails')
        if not emails:
            utils.output('end', 'no-email', utils.translate('no-email'))

    for index, email in enumerate(emails):
        isLastEmail = index == len(emails) - 1
        breached = checkForBreach(email)
        data = { 'email': email }

        if not breached:
            if isLastEmail:
                utils.output('end', 'no-pwnage', utils.translate('no-pwnage', data))
            else:
                utils.output('inter', 'no-pwnage', utils.translate('no-pwnage', data))
        else:
            data['breach'] = breached[0]['Name']
            if isLastEmail:
                utils.output('end', '', utils.translate('pwned', data))
            else:
                utils.output('inter', 'pwned', utils.translate('pwned', data))

def checkForBreach(email):
    # Delay for 2 seconds before making request to accomodate API usage policy
    sleep(2)
    truncate = '?truncateResponse=true'
    url = 'https://haveibeenpwned.com/api/v2/breachedaccount/' + parse.quote_plus(email) + truncate
    
    try:
        response = utils.http('GET', url)

        if response.status_code == 404:
            return None
        
        return response.json()
    except exceptions.RequestException as e:
        utils.output('end', 'down', utils.translate('errors', { 'website_name': 'HaveIBeenPwned' }))
