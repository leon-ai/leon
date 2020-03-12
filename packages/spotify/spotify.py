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


def pause(string, entities):
  device_id = get_device()
  if not can_play(device_id):
    return

  spotify_request('PUT', 'me/player/pause', {'device_id': device_id})
  utils.output('end', 'success', utils.translate('playing_paused'))


def play_current_track(device_id):
  spotify_request('PUT', 'me/player/play', {'device_id': device_id})
  utils.output('end', 'success', utils.translate('playing_resumed'))


def play_track(string, entities):
  device_id = get_device()
  if not can_play(device_id):
    return

  track_name = ''
  artist_name = ''

  for item in entities:
    if item['entity'] == 'track':
      track_name=item['sourceText']
    if item['entity'] == 'artist':
      artist_name = item['sourceText']

  # in case the nlu has misunderstood
  if not track_name and not artist_name:
    return play_current_track(device_id)
  if artist_name and not track_name:
    return play_artist(string, entities)

  params = {
    'q': track_name,
    'type': 'track'
  }

  if artist_name:
    params['artist'] = artist_name

  results = spotify_request('GET', 'search', params)

  file = open("mylog.txt", 'w')
  file.write(json.dumps(results))
  file.close()

  if not results['tracks']['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  chosen_track = None
  if artist_name:
    for t in results['tracks']['items']:
      for a in t['artists']:
        if a['name'].lower() == artist_name.lower():
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


def play_album(string, entities):
  device_id = get_device()
  if not can_play(device_id):
    return

  album_name = ''
  artist_name = ''

  for item in entities:
    if item['entity'] == 'album':
      album_name = item['sourceText']
    if item['entity'] == 'artist':
      artist_name = item['sourceText']

  if not album_name:
    play_current_track(device_id)

  params = {
    'q': album_name,
    'type': 'album'
  }

  if artist_name:
    params['q'] += ' artist:' + artist_name
    params['artist'] = artist_name

  results = spotify_request('GET', 'search', params)

  file = open("play_album.txt", 'w')
  file.write(json.dumps(results))
  file.close()

  if not results['albums']['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  file = open("play_album.txt", 'a')
  chosen_album = None
  if artist_name:
    for alb in results['albums']['items']:
      if alb['name'].lower() == album_name.lower():
        for art in alb['artists']:
          file.write("\nAlbum: " + alb['name'] + '\t' + "Artist: " + art['name'] + '\n')
          if art['name'].lower() == artist_name.lower():
            chosen_album = alb
            break
  file.close()

  if not chosen_album:
    chosen_album = results['albums']['items'][0]  # choose first match

  artists = []

  for artist in chosen_album['artists']:
    artists.append(artist['name'])

  data = {}
  data["context_uri"] = chosen_album["uri"]

  spotify_request('PUT', 'me/player/play', {'device_id': device_id}, json.dumps(data))

  info = {
    "name": chosen_album['name'],
    "artist": ', '.join(artists),
    "type": 'album'
  }

  utils.output('end', 'success', utils.translate('now_playing', info))


def play_artist(string, entities):
  device_id = get_device()
  if not can_play(device_id):
    return

  artist_name = ''

  for item in entities:
    if item['entity'] == 'artist':
      artist_name = item['sourceText']

  if not artist_name:
    play_current_track(device_id)

  params = {
    'q': artist_name,
    'type': 'artist'
  }

  results = spotify_request('GET', 'search', params)

  file = open("play_artist.txt", 'w')
  file.write(json.dumps(results))
  file.close()

  if not results['artists']['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  file = open("play_album.txt", 'a')

  chosen_artist = None
  for art in results['artists']['items']:
    file.write("\nArtist: " + art['name'] + '\n')
    if art['name'].lower() == artist_name.lower():
      chosen_artist = art
      break

  file.close()

  if not chosen_artist:
    chosen_artist = results['artists']['items'][0]  # choose first match

  data = {}
  data["context_uri"] = chosen_artist["uri"]

  spotify_request('PUT', 'me/player/play', {'device_id': device_id}, json.dumps(data))

  info = {
    "name": chosen_artist['name'],
    "type": 'artist'
  }

  utils.output('end', 'success', utils.translate('now_playing_artist', info))


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
