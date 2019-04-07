#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils

def producthunt(string, entities):
	"""Grab the Product Hunt trends"""

	# Developer token
	developertoken = utils.config('developer_token')

	# Number of products
	limit = 5

	# Answer key
	answerkey = 'today'

	for item in entities:
		if item['entity'] == 'number':
			limit = item['resolution']['value']

	utils.output('inter', 'reaching', utils.translate('reaching'))

	try:
		r = utils.http('GET', 'https://api.producthunt.com/v1/posts', { 'Authorization': 'Bearer ' + developertoken })
		posts = list(enumerate(r.json()['posts']))
		result = ''

		if limit > len(posts):
			utils.output('inter', 'limit_max', utils.translate('limit_max', {
			  'limit': limit,
			  'new_limit': len(posts)
			}))
			limit = len(posts)
		elif limit == 0:
			limit = 5

		for i, post in posts:
			author = { 'profile_url': '?', 'name': '?' }
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

			if (i + 1) == limit:
				break

		return utils.output('end', answerkey, utils.translate(answerkey, {
					'limit': limit,
					'result': result
				}
			)
		)
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'unreachable', utils.translate('unreachable'))
