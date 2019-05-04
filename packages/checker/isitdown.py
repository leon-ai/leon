#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils

def run(string, entities):
	"""Check if a website is down or not"""

	domains = []
	output = ''

	for item in entities:
		if item['entity'] == 'url':
			domains.append(item['resolution']['value'].lower())

	for i, domain in enumerate(domains):
		state = 'up'
		websitename = domain[:domain.find('.')].title()

		utils.output('inter', 'checking', utils.translate('checking', { 'website_name': websitename }))

		try:
			r = utils.http('GET', 'http://' + domain)

			if (r.status_code != requests.codes.ok):
				state = 'down'

			utils.output('inter', 'up', utils.translate(state, { 'website_name': websitename }))
		except requests.exceptions.RequestException as e:
			utils.output('inter', 'down', utils.translate('errors', { 'website_name': websitename }))

		if len(domains) > 1 and i >= 0 and i + 1 < len(domains):
			output += ' '

	if len(domains) == 0:
	  return utils.output('end', 'invalid_domain_name', utils.translate('invalid_domain_name'))
	else:
	  return utils.output('end', 'done')
