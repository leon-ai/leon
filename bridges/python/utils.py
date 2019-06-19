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

queryobjectpath = argv[1]
codes = []

serversrc = 'dist' if environ.get('LEON_NODE_ENV') == 'production' else 'src'
queryobjfile = open(queryobjectpath, 'r', encoding = 'utf8')
queryobj = loads(queryobjfile.read())
queryobjfile.close()

def getqueryobj():
	"""Return query object"""

	return queryobj

def translate(key, d = { }):
	"""Pickup the language file according to the cmd arg
	and return the value regarding to the params"""

	output = ''

	file = open(dirname + '/../../packages/' + queryobj['package'] + '/' + 'data/answers/' + queryobj['lang'] + '.json', 'r', encoding = 'utf8')
	obj = loads(file.read())
	file.close()

	prop = obj[queryobj['module']][key]
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
	"""Communicate with the Core"""

	codes.append(code)

	print(dumps({
		'package': queryobj['package'],
		'module': queryobj['module'],
		'action': queryobj['action'],
		'lang': queryobj['lang'],
		'input': queryobj['query'],
		'entities': queryobj['entities'],
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
	"""Get a package configuration value"""

	file = open(dirname + '/../../packages/' + queryobj['package'] + '/config/config.json', 'r', encoding = 'utf8')
	obj = loads(file.read())
	file.close()

	return obj[queryobj['module']][key]

def createdldir():
	"""Create the downloads folder of a current module"""

	dldir = path.dirname(path.realpath(__file__)) + '/../../downloads/'
	moduledldir = dldir + queryobj['package'] + '/' + queryobj['module']

	Path(moduledldir).mkdir(parents = True, exist_ok = True)

	return moduledldir

def db(dbtype = 'tinydb'):
	"""Create a new dedicated database
	for a specific package"""

	if dbtype == 'tinydb':
		ext = '.json' if environ.get('LEON_NODE_ENV') != 'testing' else '.spec.json'
		db = TinyDB(dirname + '/../../packages/' + queryobj['package'] + '/data/db/' + queryobj['package'] + ext)
		return { 'db': db, 'query': Query, 'operations': operations }
