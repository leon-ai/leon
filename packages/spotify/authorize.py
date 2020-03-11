import base64
import time

import requests

from bridges.python import utils

def run(string, entities):
  db = utils.db()['db']

  # parse url containing access code (pasted by user)
  code = string.split('?code=')[1].split("&")[0]

  payload = {'redirect_uri': utils.config('redirect_uri'),
             'code': code,
             'grant_type': 'authorization_code',
             'scope': utils.config('scope')}

  data = utils.config('client_id') + ':' + utils.config('client_secret')
  auth_header = base64.urlsafe_b64encode(data.encode('utf-8'))
  headers = {'Authorization': 'Basic %s' % auth_header.decode('utf-8')}

  results = requests.post('https://accounts.spotify.com/api/token', data=payload, headers=headers)

  token = results.json()
  token['expires_at'] = int(time.time()) + token['expires_in']
  token['client_id'] = utils.config('client_id')
  token['client_secret'] = utils.config('client_secret')
  token['url_base'] = utils.config('url_base')
  token['scope'] = utils.config('scope')

  db.insert(token)

  utils.output('end', 'success', utils.translate('logged_in'))



