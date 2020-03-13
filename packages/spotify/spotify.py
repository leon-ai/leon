import json
import webbrowser
from urllib.parse import urlencode
from bridges.python import utils

from packages.spotify.spotify_utils import parse_entities, get_device, spotify_request, logged_in, can_play, \
  display_track, display_album

from packages.spotify.spotify_utils import track, album, artist, playlist


def login(string, entities):
  if logged_in():
    return utils.output('end', 'message', utils.translate('already_logged_in'))

  config = {
    'redirect_uri': utils.config('redirect_uri'),
    'response_type': 'code',
    'client_id': utils.config('client_id'),
    'scope': utils.config('scope')
  }

  url = utils.config('auth_base') + urlencode(config)

  webbrowser.open(url)

  utils.output('end', 'success', utils.translate('login'))


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

  first_result_item = results[result_type]['items'][0]  # choose first match

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


def display_playlist(playlist):
  pass


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

  utils.output('inter', 'success', utils.translate('show_my_playlists', info))


def display_info(string, entities):
  search_query = parse_entities(entities)

  params = search_query.get_search_parameters()

  results = spotify_request('GET', 'search', params)

  result_type = search_query.get_type() + 's'
  if not results[result_type]['total'] > 0:
    return utils.output('end', 'info', utils.translate('no_search_result'))

  first_result_item = results[result_type]['items'][0]

  if search_query.get_type() == track:
    display_track(first_result_item)
  if search_query.get_type() == album:
    display_album(first_result_item)
