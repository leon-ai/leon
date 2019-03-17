#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import os
import utils
from time import time
from pytube import YouTube

def youtube(string, entities):
	"""Download new videos from a YouTube playlist"""

	db = utils.db()['db']
	query = utils.db()['query']
	operations = utils.db()['operations']
	apikey = utils.config('api_key')
	playlistid = utils.config('playlist_id')
	# https://developers.google.com/youtube/v3/docs/playlistItems/list
	url = 'https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=' + playlistid + '&key=' + apikey
	
	utils.output('inter', 'reaching_playlist', utils.translate('reaching_playlist'))
	# Get videos from the playlist
	try:
		r = utils.http('GET', url)

		# In case there is a problem like wrong settings
		if 'error' in r.json():
			error = r.json()['error']['errors'][0]
			return utils.output('settings_error', 'settings_error', utils.translate('settings_errors', {
				'reason': error['reason'],
				'message': error['message']
			}))


		items = r.json()['items']
		videoids = []
		videos = []

		for item in items:
			resource = item['snippet']['resourceId']

			if resource['kind'] == 'youtube#video':
				videoids.append(resource['videoId'])
				videos.append({
					'id': resource['videoId'],
					'title': item['snippet']['title']
				})
	except requests.exceptions.RequestException as e:
		return utils.output('request_error', 'request_error', utils.translate('request_errors'))

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
	downloadedvideos = db.get(Entry.platform == 'youtube')['downloaded_videos']

	todownload = []
	for video in videos:
		if video['id'] not in downloadedvideos:
			todownload.append(video)

	nbrtodownload = len(todownload)

	if nbrtodownload == 0:
		return utils.output('nothing_to_download', 'nothing_to_download', utils.translate('nothing_to_download'))

	utils.output('inter', 'nb_to_download', utils.translate('nb_to_download', {
		'nb': nbrtodownload
	}))

	# Create the module downloads directory
	moduledldir = utils.createdldir()

	for i, video in enumerate(todownload):
		utils.output('inter', 'downloading', utils.translate('downloading', {
			'video_title': video['title']
		}))

		# Download the video
		yt = YouTube('https://youtube.com/watch?v=' + video['id'])
		yt.streams.first().download(moduledldir)

		# Add the new downloaded video to the DB
		downloadedvideos.append(video['id'])
		db.update({ 'downloaded_videos': downloadedvideos }, Entry.platform == 'youtube')

	# Will synchronize the content (because "end" type) if synchronization enabled
	return utils.output('end', 'success', utils.translate('success'))
