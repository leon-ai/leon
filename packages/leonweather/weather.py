#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
import requests
import time

def weather(string, entities):
	"""Check the weather"""

	city = 'vide0' # On initialise la variable city
	date_flag = 0 # On initialise le flag de référentiel de temps
	timex_ref = 'EMPTY_REF'
	date_ref = 'EMPTY_REF'



	for item in entities: #On va chercher dans 'entities' la ville demandée par l'utilisateur
		if item['entity'] == 'city':
			city = item['sourceText'].lower()
		if item['entity'] == 'date':
			date_flag = 1
			date_ref = item['resolution']['date']
			timex_ref = item['resolution']['timex']
			date_ref = date_ref.replace('00:00:00.000','12:00:00.000')
		if item['entity'] == 'datetime':
			date_flag = 1
			timex_ref = item['values']['timex']

	if city == 'vide0':
		return utils.output('end', 'error', utils.translate('error'))

	date_ref = date_ref.replace('T', ' ')
	date_ref = date_ref[:19]

	if date_flag == 0 or timex_ref == 'PRESENT_REF':
		url="http://api.openweathermap.org/data/2.5/weather?appid=9ad6e7083f9e9c5d558ee4d7925e17ed&q="+city
		content=requests.get(url)
		data=content.json()

			#On test les codes d'erreurs
		if data['cod'] != 200: #Si c'est différent de 200 c'est qu'il y'a un problème
			if data['cod'] == "404": #Il ne trouve pas donc on retire virgule et espace et on retest. S'il ne trouve toujours pas on envoie un message d'erreur.
				vir = city.find(',')
				es = city.find(' ')
				pt = city.find('.')

				if vir != -1 :
					city = city[:vir]
				elif es != -1 :
					city = city[:es]
				elif pt != -1 :
					city = city[:pt]

				url="http://api.openweathermap.org/data/2.5/weather?appid=9ad6e7083f9e9c5d558ee4d7925e17ed&q="+city
				content=requests.get(url)
				data=content.json()
				if data['cod'] == "404":
					return utils.output('end', '404_city_not_found', utils.translate('404_city_not_found'))
			elif data['cod'] == "429": #Trop de demande à la minute
				return utils.output('end', 'ezy', utils.translate('ezy'))
			else :
				return utils.output('end', 'error', utils.translate('error'))

		t=data['main']['temp']
		sky=data['weather'][0]['description']

		date = time.strftime("%d-%m-%Y", time.localtime())
		hour = time.strftime("%H:%M:%S", time.localtime())
	elif date_flag != 0:
		url="http://api.openweathermap.org/data/2.5/forecast?appid=9ad6e7083f9e9c5d558ee4d7925e17ed&q="+city
		content=requests.get(url)
		data=content.json()

		#On test les codes d'erreurs
		if data['cod'] != "200": #Si c'est différent de 200 c'est qu'il y'a un problème
			if data['cod'] == "404": #Il ne trouve pas donc on retire virgule et espace et on retest. S'il ne trouve toujours pas on envoie un message d'erreur.
				vir = city.find(',')
				es = city.find(' ')
				pt = city.find('.')

				if vir != -1 :
					city = city[:vir]
				elif es != -1 :
					city = city[:es]
				elif pt != -1 :
					city = city[:pt]
				url="http://api.openweathermap.org/data/2.5/forecast?appid=9ad6e7083f9e9c5d558ee4d7925e17ed&q="+city
				content=requests.get(url)
				data=content.json()
				if data['cod'] == "404":
					return utils.output('end', '404_city_not_found', utils.translate('404_city_not_found'))
			elif data['cod'] == "429": #Trop de demande à la minute
				return utils.output('end', 'ezy', utils.translate('ezy'))
			else :
				return utils.output('end', 'error', utils.translate('error'))

		flag_w = 0
		i=0
		while i < 40 and flag_w == 0:
			if data['list'][i]['dt_txt'] == date_ref:
				flag_w = 1
				t=data['list'][i]['main']['temp']
				sky=data['list'][i]['weather'][0]['main']
				datetmp=data['list'][i]['dt_txt']
				date=datetmp[:10]
				hour=datetmp[10:]
			i = i + 1
		if flag_w == 0:
			return utils.output('end', 'error', utils.translate('error'))
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
	't' : t,
	'date':date,
	'hour':hour
	}))
