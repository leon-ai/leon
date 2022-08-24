#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import os
import utils
from time import time
from pytube import YouTube

def run(params):
	"""Download new videos from a YouTube playlist"""

	db = utils.db()['db']
	query = utils.db()['query']
	operations = utils.db()['operations']
	api_key = utils.config('credentials')['api_key']
	playlist_id = utils.config('options')['playlist_id']
	# https://developers.google.com/youtube/v3/docs/playlistItems/list
	url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + playlist_id + '&key=' + api_key

	utils.output('inter', 'reaching_playlist')
	# Get videos from the playlist
	try:
		r = utils.http('GET', url)

		# In case there is a problem like wrong settings
		if 'error' in r.json():
			error = r.json()['error']['errors'][0]
			return utils.output('end', { 'key': 'settings_error'
				'data': {
					'reason': error['reason'],
					'message': error['message']
				}
			})

		items = r.json()['items']
		video_ids = []
		videos = []

		for item in items:
			resource = item['snippet']['resourceId']

			if resource['kind'] == 'youtube#video':
				video_ids.append(resource['videoId'])
				videos.append({
					'id': resource['videoId'],
					'title': item['snippet']['title']
				})
	except requests.exceptions.RequestException as e:
		return utils.output('end', 'request_error')

	Entry = query()

	# First initialization
	if db.count(Entry.platform == 'youtube') == 0:
		db.insert({
			'platform': 'youtube',
			'checked_at': int(time()),
			'downloaded_videos': []
		})
	else:
		db.update({ 'checked_at': int(time()) }, Entry.platform == 'youtube')

	# Get videos already downloaded
	downloaded_videos = db.get(Entry.platform == 'youtube')['downloaded_videos']

	to_download = []
	for video in videos:
		if video['id'] not in downloaded_videos:
			to_download.append(video)

	nbrto_download = len(to_download)

	if nbrto_download == 0:
		return utils.output('end', 'nothing_to_download')

	utils.output('inter', { 'key': 'nb_to_download'
		'data': {
			'nb': nbrto_download
		}
	})

	# Create the skill downloads directory
	skill_dl_dir = utils.create_dl_dir()

	for i, video in enumerate(to_download):
		utils.output('inter', { 'key': 'downloading'
			'data': {
				'video_title': video['title']
			}
		})

		# Download the video
		yt = YouTube('https://youtube.com/watch?v=' + video['id'])
		yt.streams.first().download(skill_dl_dir)

		# Add the new downloaded video to the DB
		downloaded_videos.append(video['id'])
		db.update({ 'downloaded_videos': downloaded_videos }, Entry.platform == 'youtube')

	# Will synchronize the content (because "end" type) if synchronization enabled
	return utils.output('end', 'success')
