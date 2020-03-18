#!/usr/bin/env python
# -*- coding:utf-8 -*-

import base64
import json
import socket
import time
import requests
from urllib.parse import urlencode

from bridges.python import utils

track_str = 'track'
artist_str = 'artist'
album_str = 'album'
playlist_str = 'playlist'


class SearchQuery:
  def __init__(self, track=None, artist=None, album=None, playlist=None):
    self.track = track
    self.artist = artist
    self.album = album
    self.playlist = playlist

  def get_type(self):
    if self.track:
      return track_str
    if self.album:
      return album_str
    if self.artist:
      return artist_str
    if self.playlist:
      return playlist_str
    return None

  def get_query_string(self):
    if self.track and self.artist:
      return '{} artist:{}'.format(self.track, self.artist)
    if self.album and self.artist:
      return '{} artist:{}'.format(self.album, self.artist)
    if self.track:
      return self.track
    if self.album:
      return self.album
    if self.artist:
      return self.artist
    if self.playlist:
      return self.playlist
    return ''

  def get_search_parameters(self):
    return {
      'q': self.get_query_string(),
      'type': self.get_type()
    }


def format_time(millis):
  seconds = int((millis / 1000)) % 60
  minutes = int((millis / (1000 * 60))) % 60
  hours = int((millis / (1000 * 60 * 60))) % 24
  if (hours == 0):
    return '{:02d}:{:02d}'.format(minutes, seconds)

  return '{:02d}:{:02d}:{:02d}'.format(hours, minutes, seconds)


def parse_entities(entities):
  query = SearchQuery()
  for item in entities:
    if item['entity'] == track_str:
      query.track = item['sourceText']
    if item['entity'] == artist_str:
      query.artist = item['sourceText']
    if item['entity'] == album_str:
      query.album = item['sourceText']
    if item['entity'] == playlist_str:
      query.playlist = item['sourceText']

  return query


def track_to_html_list(info):
  return "<p><strong>{}</strong><p>" \
         "<ul style=\"list-style-type:none;\">" \
         "<li>from album {}</li>" \
         "<li>by \'{}\'</li>" \
         "<li>popularity: {}%</li>" \
         "<li>playing time: {}</li></ul>".format(info['name'], info['album'], info['artist'], info['popularity'], info['duration'])


def display_track(track):
  info = {
    "name": track['name'],
    "duration": format_time(track['duration_ms']),
    "album": track['album']['name'],
    "popularity": track['popularity']
  }

  artists = []
  for artist in track['artists']:
    artists.append(artist['name'])

  info["artist"] = ', '.join(artists)

  return utils.output('end', 'success', utils.translate('display_info', {"info": track_to_html_list(info)}))


def album_to_html_table(album):
  tracks_table = '<table>'

  for track in album['tracks']:
    tracks_table += '<tr><td>{}</td><td>{}</td></tr>'.format(track['name'], track['duration'])

  tracks_table += '</table>'

  return "<p><strong>{}</strong><p>" \
         "<ul style=\"list-style-type:none;\">" \
         "<li>by \'{}\'</li>" \
         "<img src='{}' width='50%' />" \
         "<p><u>Tracks</u></p>{}" \
         .format(album['name'], album['artist'], album['image_url'], tracks_table)


def display_album(album):
  info = {
    "name": album['name'],
    "type": album['type'],
    "image_url": album['images'][0]['url']
  }

  result = spotify_request('GET', 'albums/' + album['id'] + '/tracks', {})

  tracks = []
  for tr in result['items']:
    tracks.append({"name": tr['name'], "duration": format_time(tr['duration_ms'])})

  info['tracks'] = tracks

  artists = []
  for art in album['artists']:
    artists.append(art['name'])

  info["artist"] = ', '.join(artists)

  return utils.output('end', 'success', utils.translate('display_info', {"info": album_to_html_table(info)}))


def create_tracks_table(tracks):
  tracks_table = '<table><thead style="border-bottom:1px solid black"><tr><th>Track name</th><th>Artist</th><th>Playing time</th></tr></thead><tbody>'
  for track in tracks:
    tracks_table += '<tr><td>{}</td><td>{}</td><td style="text-align:right">{}</td></tr>'.format(track['name'],
                                                                                                 track['artist'],
                                                                                                 track['duration'])
  tracks_table += '</tbody></table>'
  return tracks_table


def playlist_to_html_table(playlist):
  tracks_table = create_tracks_table(playlist['tracks'])

  return "<p><strong>{}</strong><p>" \
         "<p class='italic'>{}<p>" \
         "<ul style=\"list-style-type:none;\">" \
         "{}" \
         .format(playlist['name'], playlist['description'], tracks_table)


def display_playlist(playlist):
  info = {
    "name": playlist['name'],
    "description": playlist['description']
  }

  result = spotify_request('GET', 'playlists/' + playlist['id'] + '/tracks', {"limit": 20})

  tracks = []
  for tr in result['items']:
    # tracks may be null if not available anymore
    if tr:
      tracks.append({"name": tr['track']['name'], "duration": format_time(tr['track']['duration_ms']), "artist": tr['track']['artists'][0]['name']})

  info['tracks'] = tracks

  return utils.output('end', 'success', utils.translate('display_info', {"info": playlist_to_html_table(info)}))


def artist_to_html_list(info):
  return "<p><strong>{}</strong><p>" \
         "<ul style=\"list-style-type:none;\">" \
         "<li>popularity: {}%</li>" \
         "<li>followers: {}</li>" \
         "<li>genres: {}</li></ul>" \
         "<p><u>Top tracks</u></p> {}".format(info['name'], info['popularity'], info['num_followers'], info['genres'], info['top_tracks'])


def display_artist(artist):
  info = {
    "name": artist['name'],
    "num_followers":  artist['followers']['total'],
    "popularity": artist['popularity']
  }

  user_info = spotify_request('GET', 'me', {})

  result = spotify_request('GET', 'artists/' + artist['id'] + '/top-tracks', {'country': user_info['country']})

  top_tracks = []
  for tr in result['tracks']:
    top_tracks.append({"name": tr['name'], "duration": format_time(tr['duration_ms']), "artist": artist['name']})

  info['tracks'] = top_tracks

  top_tracks_table = create_tracks_table(top_tracks)

  info['top_tracks'] = top_tracks_table

  genres = []
  for genre in artist['genres']:
    genres.append(genre)

  info["genres"] = ', '.join(genres)

  return utils.output('end', 'success', utils.translate('display_info', {"info": artist_to_html_list(info)}))


def get_database_content():
  return utils.db()['db'].all()[0]


def token_expired(expires_at):
  now = int(time.time())
  return expires_at - now < 60


def logged_in():
  db = utils.db()['db'].all()
  if len(db) > 0:
    db = get_database_content()  # token info
    now = int(time.time())
    return now < db['expires_at']

  return False


def can_play(device):
  if not device:
    utils.output('end', 'error', utils.translate('no_device'))
    return False

  if device and not device['is_active']:
    utils.output('end', 'error', utils.translate('device_not_active'))
    return False

  return True


def get_access_token():
  data = get_database_content()
  access_token = data['access_token']
  expires_at = data['expires_at']
  refresh_token = data['refresh_token']

  if token_expired(expires_at):
    access_token = refresh_access_token(refresh_token)

  return access_token


def refresh_access_token(refresh_token):
  payload = {'refresh_token': refresh_token, 'grant_type': 'refresh_token'}

  db_content = get_database_content()
  client_id = db_content['client_id']
  client_secret= db_content['client_secret']

  data = client_id + ':' + client_secret
  auth_header = base64.urlsafe_b64encode(data.encode('utf-8'))
  headers = {'Authorization': 'Basic %s' % auth_header.decode('utf-8')}

  response = requests.post('https://accounts.spotify.com/api/token', data=payload, headers=headers)

  token_info = response.json()

  db = utils.db()['db']
  db.update({"access_token": token_info['access_token']})
  return token_info['access_token']


def spotify_request(method, endpoint, query_params, body_params={}):
  access_token = get_access_token()
  url_base = get_database_content()['url_base']
  url = url_base + endpoint + '?' + urlencode(query_params)
  result = requests.request(method=method, url=url, headers={'Authorization': 'Bearer {0}'.format(
    access_token), 'Content-Type': 'application/json'}, data=body_params)

  if result.text and len(result.text) > 0 and result.text != 'null':
    return result.json()
  else:
    return None


def get_device():
  access_token = get_access_token()
  url_base = get_database_content()['url_base']
  url = url_base + 'me/player/devices'
  devices = requests.get(url=url, headers={'Authorization': 'Bearer {0}'.format(access_token)}).json()
  current_device_name = socket.gethostname()

  device = None
  for dev in devices['devices']:
    if (dev['name'].lower() == current_device_name):
      device = dev
  return device


def get_current_track():
  data = {}
  currently_playing = spotify_request('GET', 'me/player/currently-playing', {})['item']

  data['name'] = currently_playing['name']

  artists = []

  for artist in currently_playing['artists']:
    artists.append(artist['name'])

  data['artists'] = ', '.join(artists)

  return data
