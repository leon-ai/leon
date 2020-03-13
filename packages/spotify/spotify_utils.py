import base64
import socket
import time
from urllib.parse import urlencode

import requests

from bridges.python import utils

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
    if item['entity'] == track:
      query.track = item['sourceText']
    if item['entity'] == artist:
      query.artist = item['sourceText']
    if item['entity'] == album:
      query.album = item['sourceText']
    if item['entity'] == playlist:
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

  utils.output('end', 'success', utils.translate('display_info', {"info": track_to_html_list(info)}))


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

  file = open("album_tracks.txt", 'w')
  file.write(json.dumps(result))
  file.close()

  tracks = []
  for tr in result['items']:
    tracks.append({"name": tr['name'], "duration": format_time(tr['duration_ms'])})

  info['tracks'] = tracks

  artists = []
  for art in album['artists']:
    artists.append(art['name'])

  info["artist"] = ', '.join(artists)

  utils.output('end', 'success', utils.translate('display_info', {"info": album_to_html_table(info)}))


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
    file = open("isloggedin.txt", 'w')
    file.write("Expires at: " + str(db['expires_at']) + '\t' + "Now: " + str(now))
    file.close()
    return now < db['expires_at']

  return False


def can_play(device):
  if not logged_in():
    utils.output('end', 'error', utils.translate('not_logged_in'))
    return False

  if not device:
    utils.output('end', 'error', utils.translate('no_device'))
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
