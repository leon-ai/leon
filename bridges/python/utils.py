#!/usr/bin/env python
# -*- coding:utf-8 -*-

from json import loads, dumps
from os import path, environ
from pathlib import Path
from random import choice
from sys import argv, stdout
from vars import useragent
from tinydb import TinyDB, Query, operations
from time import sleep
import sqlite3
import requests
import re

dirname = path.dirname(path.realpath(__file__))

intent_object_path = argv[1]
codes = []

intent_obj_file = open(intent_object_path, 'r', encoding = 'utf8')
intent_obj = loads(intent_obj_file.read())
intent_obj_file.close()

def get_intent_obj():
	"""Return intent object"""

	return intent_obj

def translate(key, d = { }):
	"""Pickup the language file according to the cmd arg
	and return the value according to the params"""

	output = ''

	file = open(path.join(dirname, '../../domains', intent_obj['domain'], intent_obj['skill'], 'nlu', intent_obj['lang'] + '.json'), 'r', encoding = 'utf8')
	obj = loads(file.read())
	file.close()

	prop = obj.actions[intent_obj['action']].answers[key]
	if isinstance(prop, list):
		output = choice(prop)
	else:
		output = prop

	if d:
		for k in d:
			output = output.replace('%' + k + '%', str(d[k]))

	# "Temporize" for the data buffer ouput on the core
	sleep(0.1)

	return output

def output(type, code, speech = ''):
	"""Communicate with the core"""

	codes.append(code)

	print(dumps({
		'domain': intent_obj['domain'],
		'skill': intent_obj['skill'],
		'action': intent_obj['action'],
		'lang': intent_obj['lang'],
		'utterance': intent_obj['utterance'],
		'entities': intent_obj['entities'],
		'output': {
			'type': type,
			'codes': codes,
			'speech': speech,
			'options': config('options')
		}
	}))

	if (type == 'inter'):
		stdout.flush()

def http(method, url, headers = None):
	"""Send HTTP request with the Leon user agent"""

	session = requests.Session()
	session.headers.update({ 'User-Agent': useragent, 'Cache-Control': 'no-cache' })

	if headers != None:
	  session.headers.update(headers)

	return session.request(method, url)

def config(key):
	"""Get a skill configuration value"""

	file = open(path.join(dirname, '../../skills', intent_obj['domain'], intent_obj['skill'], 'src/config.json'), 'r', encoding = 'utf8')
	obj = loads(file.read())
	file.close()

	return obj.configurations[key]

def create_dl_dir():
	"""Create the downloads folder of a current skill"""

	dl_dir = path.dirname(path.realpath(__file__)) + '/../../downloads/'
	skill_dl_dir = path.join(dl_dir, intent_obj['domain'], intent_obj['skill'])

	Path(skill_dl_dir).mkdir(parents = True, exist_ok = True)

	return skill_dl_dir

def db(db_type = 'tinydb'):
	"""Create a new dedicated database
	for a specific skill"""

	if db_type == 'tinydb':
		ext = '.json' if environ.get('LEON_NODE_ENV') != 'testing' else '.spec.json'
		db = TinyDB(path.join(dirname, '../../skills', intent_obj['domain'], intent_obj['skill'], 'memory/db' + ext))
		return { 'db': db, 'query': Query, 'operations': operations }
