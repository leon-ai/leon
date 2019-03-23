#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
from bs4 import BeautifulSoup

def github(string, entities):
	"""Grab the GitHub trends"""

	# See rate limit here https://developer.github.com/v3/search/#rate-limit
	# Without GitHub token, you can make up to 10 requests per minute
	# With a GitHub token, you can make up to 30 requests per minute
	#
	# To improve the GitHub search query, here is the GitHub docs: https://help.github.com/en/articles/searching-for-repositories
	#
	# Get a new token
	#
	# 1. https://github.com/settings/tokens
	# 2. "Generate new token"
	# 3. Put a token description such as "Leon Trend package"
	# 4. No need to check any checkbox as we only read public repositories
	# 5. Copy directly your token in the config file (SHOW WHICH FILE)

	# 1. Grab trendings
	# 2. Be able to grab trending per language also. Do an array of languages here via the list https://github.com/trending
	# 3. Spot the language in the query and check if it exists in the array
	# 4. Be able to grab last week and last month and per language

	# Build the languages array according to the languages listed on the trending page

	# Leon, give me the 10 GitHub trends of this week for the JavaScript language
	# 10, this week, JavaScript
	# 1 - 25, today|this week|this month, languages listed on the page (force lowercase for matching)

	# Here are the 10 latest GitHub trends of this week for the JavaScript language:
	# link? {REPO NAME} by {AUTHOR NAME}
	# ...

	utils.output('inter', 'reaching', utils.translate('reaching'))

	try:
		r = utils.http('GET', 'https://github.com/trending')
		soup = BeautifulSoup(r.text, features='html.parser')
		limit = 5
		reponames = soup.select('.repo-list h3', limit=limit)
		authornames = ''

		print('reponames', reponames)
		print('authornames', authornames)
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'unreachable', utils.translate('unreachable'))

	return utils.output('end', 'done')
