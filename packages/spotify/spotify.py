#!/usr/bin/env python
# -*- coding:utf-8 -*-

import base64
import json
import time
import webbrowser
import requests
from urllib.parse import urlencode

from bridges.python import utils
from packages.spotify.spotify_utils import parse_entities, get_device, spotify_request, logged_in, can_play, \
  display_track, display_album, display_playlist, display_artist
from packages.spotify.spotify_utils import track_str, album_str, artist_str, playlist_str


def login(string, entities):
  if logged_in():
    return utils.output('end', 'message', utils.translate('already_logged_in'))

  config = {
    'redirect_uri': utils.config('redirect_uri'),
    'response_type': 'code',
    'client_id': utils.config('client_id'),
    'scope': utils.config('scope')
  }

  url = "{}{}".format(utils.config('auth_base'), urlencode(config))

  webbrowser.open(url)

  return utils.output('end', 'success', utils.translate('login'))


def authorize(string, entities):
  db = utils.db()['db']

  # parse url containing access code (pasted by user)
  code = string.split('?code=')[1].split("&")[0]

  # workaround for what I can only assume is an error in the spotify accounts service
  if code.endswith("#_=_"):
    return utils.output('end', 'error', utils.translate('try_again_workaround'))

  payload = {'redirect_uri': utils.config('redirect_uri'),
             'code': code,
             'grant_type': 'authorization_code',
             'scope': utils.config('scope')}

  data = utils.config('client_id') + ':' + utils.config('client_secret')
  encoded_data = base64.urlsafe_b64encode(data.encode('utf-8'))
  headers = {'Authorization': 'Basic {}'.format(str(encoded_data, 'utf-8'))}

  results = requests.post('https://accounts.spotify.com/api/token', data=payload, headers=headers)

  token = results.json()

  # add info fields to token object
  token['expires_at'] = int(time.time()) + token['expires_in']
  token['client_id'] = utils.config('client_id')
  token['client_secret'] = utils.config('client_secret')
  token['url_base'] = utils.config('url_base')
  token['scope'] = utils.config('scope')

  # in case new login because of expired token
  if len(db.all()) > 0:
    db.purge()

  db.insert(token)

  return utils.output('end', 'success', utils.translate('logged_in'))


def play(string, entities):
  if not logged_in():
    return utils.output('end', 'error', utils.translate('not_logged_in'))

  device = get_device()
  # is spotify running and user logged in?
  if not can_play(device):
    return

  device_id = device['id']

  # create search query object from entities retrieved from the nlu
  search_query = parse_entities(entities)

  if not search_query.get_type():
    return play_current_track(device_id)

  params = search_query.get_search_parameters()

  results = spotify_request('GET', 'search', params)

  result_type = search_query.get_type() + 's'
  if not results[result_type]['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  first_result_item = results[result_type]['items'][0]  # choose first match

  data = {}
  if (search_query.get_type() == track_str):
    data["uris"] = [first_result_item["uri"]]
  else:
    data["context_uri"] = first_result_item["uri"]

  spotify_request('PUT', 'me/player/play', {'device_id': device_id}, json.dumps(data))

  info = {
    "name": first_result_item['name'],
    "type": search_query.get_type()
  }

  if search_query.get_type() == track_str or search_query.get_type() == album_str:
    artists = []
    for artist in first_result_item['artists']:
      artists.append(artist['name'])
      info["artist"] = ', '.join(artists)

    return utils.output('end', 'success', utils.translate('now_playing_by', info))

  return utils.output('end', 'success', utils.translate('now_playing', info))


def pause(string, entities):
  if not logged_in():
    return utils.output('end', 'error', utils.translate('not_logged_in'))

  device = get_device()
  if not can_play(device):
    return
  device_id = device['id']
  spotify_request('PUT', 'me/player/pause', {'device_id': device_id})
  utils.output('end', 'success', utils.translate('playing_paused'))


def play_current_track(device_id):
  spotify_request('PUT', 'me/player/play', {'device_id': device_id})
  return utils.output('end', 'success', utils.translate('playing_resumed'))


def show_my_playlists(string, entities):
  if not logged_in():
    return utils.output('end', 'error', utils.translate('not_logged_in'))

  utils.output('inter', 'message', utils.translate('contacting_spotify'))

  results = spotify_request('GET', 'me/playlists', {})

  if not results['total'] > 0:
    return utils.output('end', 'message', utils.translate('no_playlists'))

  playlist_list = '<ul>'
  for playlist in results['items']:
    playlist_list += '<li>' + playlist['name'] + '</li>'

  info = {
    "playlists": playlist_list,
    "num_playlists": results['total']
  }

  return utils.output('inter', 'success', utils.translate('show_my_playlists', info))


def display_info(string, entities):
  search_query = parse_entities(entities)

  if not search_query.get_type():
    return utils.output('end', 'message', utils.translate('no_search_term'))

  params = search_query.get_search_parameters()
  params['limit'] = 1

  results = spotify_request('GET', 'search', params)

  utils.output('inter', 'message', utils.translate('contacting_spotify'))

  result_type = search_query.get_type() + 's'
  if not results[result_type]['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  first_result_item = results[result_type]['items'][0]

  if search_query.get_type() == track_str:
    display_track(first_result_item)
  elif search_query.get_type() == album_str:
    display_album(first_result_item)
  elif search_query.get_type() == playlist_str:
    display_playlist(first_result_item)
  elif search_query.get_type() == artist_str:
    display_artist(first_result_item)

  return
