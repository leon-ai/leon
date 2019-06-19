#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils

def run(string, entities):
	"""Grab the Product Hunt trends"""

	# Developer token
	developertoken = utils.config('developer_token')

	# Number of products
	limit = 5

	# Answer key
	answerkey = 'today'

	# Day date
	daydate = ''

	for item in entities:
		if item['entity'] == 'number':
			limit = item['resolution']['value']
		if item['entity'] == 'date':
			answerkey = 'specific_day'

			if 'strPastValue' in item['resolution']:
				daydate = item['resolution']['strPastValue']
			else:
				daydate = item['resolution']['strValue']

	utils.output('inter', 'reaching', utils.translate('reaching'))

	try:
		url = 'https://api.producthunt.com/v1/posts'
		if (daydate != ''):
			url = url + '?day=' + daydate

		r = utils.http('GET', url, { 'Authorization': 'Bearer ' + developertoken })
		response = r.json()

		if 'error' in response and response['error'] == 'unauthorized_oauth':
			return utils.output('end', 'invalid_developer_token', utils.translate('invalid_developer_token'))

		posts = list(enumerate(response['posts']))
		result = ''

		if len(posts) == 0:
			return utils.output('end', 'not_found', utils.translate('not_found'))

		if limit > len(posts):
			utils.output('inter', 'limit_max', utils.translate('limit_max', {
			  'limit': limit,
			  'new_limit': len(posts)
			}))
			limit = len(posts)
		elif limit == 0:
			limit = 5

		for i, post in posts:
			# If the product maker is known
			if post['maker_inside']:
				author = list(reversed(post['makers']))[0]
				result += utils.translate('list_element', {
						'rank': i + 1,
						'post_url': post['discussion_url'],
						'product_name': post['name'],
						'author_url': author['profile_url'],
						'author_name': author['name'],
						'votes_nb': post['votes_count']
					}
				)
			else:
				result += utils.translate('list_element_with_unknown_maker', {
						'rank': i + 1,
						'post_url': post['discussion_url'],
						'product_name': post['name'],
						'votes_nb': post['votes_count']
					}
				)

			if (i + 1) == limit:
				break

		return utils.output('end', answerkey, utils.translate(answerkey, {
					'limit': limit,
					'result': result,
					'date': daydate
				}
			)
		)
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'unreachable', utils.translate('unreachable'))
