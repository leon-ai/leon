#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
import packages.trend.github_lang as github_lang
from re import search, escape
from bs4 import BeautifulSoup

def github(string, entities):
	"""Grab the GitHub trends"""
	
	# Number of repositories
	limit = 5

	# Range string
	since = 'daily'

	# Language slug
	langslug = ''

	for item in entities:
		if item['entity'] == 'number':
			limit = item['resolution']['value']
		if item['entity'] == 'daterange':
			if item['resolution']['timex'].find('W') != -1:
				since = 'weekly'
			else:
				since = 'monthly'

	# Feed the languages list based on the GitHub languages list
	for i, language in enumerate(github_lang.getall()):
		# Find the asked language
		if search(r'\b' + escape(language.lower()) + r'\b', string.lower()):
			langslug = language.lower()

	if limit > 25:
		utils.output('inter', 'limit_max', utils.translate('limit_max'))
		limit = 25
	elif limit == 0:
		limit = 5

	utils.output('inter', 'reaching', utils.translate('reaching'))

	try:
		r = utils.http('GET', 'https://github.com/trending/' + langslug + '?since=' + since)
		soup = BeautifulSoup(r.text, features='html.parser')
		elements = soup.select('.repo-list li', limit=limit)
		result = ''

		for i, element in enumerate(elements):
			repository = element.h3.get_text(strip=True).replace(' ', '')
			author = element.img.get('alt')[1:]
			stars = element.select('span.d-inline-block.float-sm-right')[0].get_text(strip=True).split(' ')[0]
			separators = [' ', ',', '.']

			# Replace potential separators number
			for j, separator in enumerate(separators):
				stars = stars.replace(separator, '')

			result += utils.translate('list_element', {
						'rank': i + 1,
						'repository_url': 'https://github.com/' + repository,
						'repository_name': repository,
						'author_url': 'https://github.com/' + author,
						'author_username': author,
						'stars_nb': stars
					}
				)

		utils.output('end', 'done', utils.translate('today', {
					'limit': limit,
					'result': result
				}
			)
		)
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'unreachable', utils.translate('unreachable'))
