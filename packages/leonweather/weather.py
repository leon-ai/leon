#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
import requests

def weather(string, entities):
	"""Check the weather"""

	city = 'vide0' #On initialise la variable city

	for item in entities: #On va chercher dans 'entities' la ville demandée par l'utilisateur
		if item['entity'] == 'city':
			city = item['sourceText'].lower()

	if city == 'vide0':
		return utils.output('end', 'error', utils.translate('error'))

	url="http://api.openweathermap.org/data/2.5/weather?appid=9ad6e7083f9e9c5d558ee4d7925e17ed&q="+city
	content=requests.get(url)
	data=content.json()

	#On test les codes d'erreurs
	if data['cod'] != 200: #Si c'est différent de 200 c'est qu'il y'a un problème
		if data['cod'] == "404": #Il ne trouve pas
			return utils.output('end', '404_city_not_found', utils.translate('404_city_not_found'))
		elif data['cod'] == "429": #Trop de demande à la minute
			return utils.output('end', 'ezy', utils.translate('ezy'))
		else :
			return utils.output('end', 'error', utils.translate('error'))

	t=data['main']['temp']
	sky=data['weather'][0]['main']

	t=t-273.15
	t = round(t,1)

	vir = city.find(',')
	es = city.find(' ')

	if vir != -1 :
		city = city[:vir]
	elif es != -1 :
		city = city[:es]

	city = city.capitalize()
	sky = sky.lower()

	return utils.output('end', 'weather', utils.translate('weather', {
	'cit':city,
	'sky': sky,
	't' : t
	}))
