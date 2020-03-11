import base64
import json
import socket
import time
import webbrowser
from urllib.parse import urlencode

from bridges.python import utils
import requests

auth_base = 'https://accounts.spotify.com/authorize?'

def logged_in():
  db = utils.db()['db'].all()
  if len(db) > 0:
    db = get_database_content()
    now = int(time.time())
    return int(db['expires_at']) > now

  return False

def get_database_content():
  return utils.db()['db'].all()[0]

def login(string, entities):
  config = {
    'redirect_uri': utils.config('redirect_uri'),
    'response_type': 'code',
    'client_id': utils.config('client_id'),
    'scope': utils.config('scope')
  }

  url = auth_base + urlencode(config)

  webbrowser.open(url)

  utils.output('end', 'success', utils.translate('login'))

def play(string, entities):
  if not logged_in():
    return utils.output('end', 'error', utils.translate('not_logged_in'))

  device = get_device()
  if not device:
    return utils.output('end', 'error', utils.translate('no_device'))

  track=''
  album=''
  artist=''
  playlist=''

  # which search parameters are specified
  for item in entities:
    if item['entity'] == 'track':
      track=item['sourceText']
    if item['entity'] == 'artist':
      artist = item['sourceText']
    if item['entity'] == 'album':
      album = item['sourceText']
    if item['entity'] == 'playlist':
      playlist = item['sourceText']

  if device:
    if album:
      play_album(device, album, artist)
    elif playlist:
      play_playlist(device, playlist)
    elif track:
      play_track(device, track, artist)
    elif artist:
      play_artist(device, artist)
    else:
      play_current_track(device)


def play_current_track(device):
  spotify_request('PUT', 'me/player/play', {'device_id': device})
  utils.output('end', 'success', utils.translate('resume_playing'))


def play_track(device_id, track_name, artist=None):
  params = {
    'q': track_name,
    'type': 'track'
  }

  if artist:
    params['artist'] = artist

  results = spotify_request('GET', 'search', params)

  file = open("mylog.txt", 'w')
  file.write(json.dumps(results))
  file.close()

  if not results['tracks']['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  chosen_track = None
  if artist:
    for t in results['tracks']['items']:
      for a in t['artists']:
        if a['name'].lower() == artist.lower():
          chosen_track = t
          break

  if not chosen_track:
    chosen_track = results['tracks']['items'][0]  # choose first match

  artists = []

  for artist in chosen_track['artists']:
    artists.append(artist['name'])

  data = {}
  data["uris"] = [chosen_track["uri"]]

  file = open("chosentrack_uri.txt", 'w')
  file.write(chosen_track["uri"])
  file.close()

  spotify_request('PUT', 'me/player/play', {'device_id': device_id}, json.dumps(data))

  info = {
    "name": chosen_track['name'],
    "artist": ', '.join(artists),
    "type": 'track'
  }

  utils.output('end', 'success', utils.translate('now_playing', info))


def play_album(device, album, artist=None):
  pass

def play_artist(device, artist):
  pass

def play_playlist(device, playlist):
  pass

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

  file = open("putresult.txt", 'w')
  file.write(result.text)
  file.close()

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

  file = open('logfile.txt', 'w')
  file.write(json.dumps(devices))
  file.close()

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
