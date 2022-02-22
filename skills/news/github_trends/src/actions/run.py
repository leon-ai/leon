#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
from ..lib import github_lang
from re import search, escape
from bs4 import BeautifulSoup

def run(string, entities):
	"""Get the GitHub trends"""

	# Number of repositories
	limit = 5

	# Range string
	since = 'daily'

	# Technology slug
	tech_slug = ''

	# Technology name
	tech = ''

	# Answer key
	answer_key = 'today'

	for item in entities:
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
		if search(r'\b' + escape(language.lower()) + r'\b', string.lower()):
			answer_key += '_with_tech'
			tech = language
			tech_slug = language.lower()

	if limit > 25:
		utils.output('inter', 'limit_max', utils.translate('limit_max', {
		  'limit': limit
		}))
		limit = 25
	elif limit == 0:
		limit = 5

	utils.output('inter', 'reaching', utils.translate('reaching'))

	try:
		r = utils.http('GET', 'https://github.com/trending/' + tech_slug + '?since=' + since)
		soup = BeautifulSoup(r.text, features='html.parser')
		elements = soup.select('article.Box-row', limit=limit)
		result = ''

		for i, element in enumerate(elements):
			repository = element.h1.get_text(strip=True).replace(' ', '')
			if (element.img != None):
				author = element.img.get('alt')[1:]
			else:
				author = '?'

			has_stars = element.select('span.d-inline-block.float-sm-right')
			stars = 0

			if has_stars:
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

		return utils.output('end', answer_key, utils.translate(answer_key, {
					'limit': limit,
					'tech': tech,
					'result': result
				}
			)
		)
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'unreachable', utils.translate('unreachable'))
