import base64
import json
import socket
import time
import webbrowser
from urllib.parse import urlencode

from bridges.python import utils
import requests

auth_base = 'https://accounts.spotify.com/authorize?'

track = 'track'
artist = 'artist'
album = 'album'
playlist = 'playlist'

class SearchQuery:
  def __init__(self, track=None, artist=None, album=None, playlist=None):
    self.track = track
    self.artist = artist
    self.album = album
    self.playlist = playlist

  def get_type(self):
    if self.track:
      return track
    if self.album:
      return album
    if self.artist:
      return artist
    if self.playlist:
      return playlist
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


def logged_in():
  db = utils.db()['db'].all()
  if len(db) > 0:
    db = get_database_content()  # token info
    now = int(time.time())
    file = open("isloggedin.txt", 'w')
    file.write("Expires at: " + str(db['expires_at']) + '\t' + "Now: " + str(now))
    file.close()
    return now < db['expires_at']

  return False


def get_database_content():
  return utils.db()['db'].all()[0]


def login(string, entities):
  if logged_in():
    return utils.output('end', 'message', utils.translate('already_logged_in'))

  config = {
    'redirect_uri': utils.config('redirect_uri'),
    'response_type': 'code',
    'client_id': utils.config('client_id'),
    'scope': utils.config('scope')
  }

  url = auth_base + urlencode(config)

  webbrowser.open(url)

  utils.output('end', 'success', utils.translate('login'))


def can_play(device):
  if not logged_in():
    utils.output('end', 'error', utils.translate('not_logged_in'))
    return False

  if not device:
    utils.output('end', 'error', utils.translate('no_device'))
    return False

  return True


def parse_entities(entities):
  query = SearchQuery()
  for item in entities:
    if item['entity'] == track:
      query.track = item['sourceText']
    if item['entity'] == artist:
      query.artist = item['sourceText']
    if item['entity'] == album:
      query.album = item['sourceText']
    if item['entity'] == playlist:
      query.playlist = item['sourceText']

  return query


def play(string, entities):
  device_id = get_device()
  # is spotify running and user logged in?
  if not can_play(device_id):
    return

  # create search query object from entities retrieved from the nlu
  search_query = parse_entities(entities)

  if not search_query.get_type():
    return play_current_track(device_id)

  params = search_query.get_search_parameters()

  results = spotify_request('GET', 'search', params)

  result_type = search_query.get_type() + 's'
  if not results[result_type]['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  first_result_item= results[result_type]['items'][0]  # choose first match

  data = {}
  if (search_query.get_type() == track):
    data["uris"] = [first_result_item["uri"]]
  else:
    data["context_uri"] = first_result_item["uri"]

  spotify_request('PUT', 'me/player/play', {'device_id': device_id}, json.dumps(data))

  info = {
    "name": first_result_item['name'],
    "type": search_query.get_type()
  }

  if search_query.get_type() == track or search_query.get_type() == album:
    artists = []
    for artist in first_result_item['artists']:
      artists.append(artist['name'])
      info["artist"] = ', '.join(artists)

    return utils.output('end', 'success', utils.translate('now_playing_by', info))

  utils.output('end', 'success', utils.translate('now_playing', info))

def pause(string, entities):
  device_id = get_device()
  if not can_play(device_id):
    return

  spotify_request('PUT', 'me/player/pause', {'device_id': device_id})
  utils.output('end', 'success', utils.translate('playing_paused'))


def play_current_track(device_id):
  spotify_request('PUT', 'me/player/play', {'device_id': device_id})
  utils.output('end', 'success', utils.translate('playing_resumed'))


def token_expired(expires_at):
  now = int(time.time())
  return expires_at - now < 60


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
  devices = requests.get(
    url=url, headers={'Authorization': 'Bearer {0}'.format(access_token)}).json()
  current_device_name = socket.gethostname()

  device_id = False
  for device in devices['devices']:
    if (device['name'].lower() == current_device_name):
      device_id = device['id']
  return device_id


def get_current_track():
  data = {}
  currently_playing = spotify_request('GET', 'me/player/currently-playing', {})['item']

  data['name'] = currently_playing['name']

  artists = []

  for artist in currently_playing['artists']:
    artists.append(artist['name'])

  data['artists'] = ', '.join(artists)

  return data
