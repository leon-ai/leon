#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
import requests
import time


def weather(string, entities):
	"""Check the weather"""

	# We init city
	city = 'vide0'
	# We init the time flag.
	date_flag = 0
	timex_ref = 'EMPTY_REF'
	date_ref = 'EMPTY_REF'
	date_mem = 'EMPTY_REF'

	number_of_cities = 0
	# We init API Key & check it
	API_key = utils.config('API_key')
	if API_key == '0000':
		API_key = '9ad6e7083f9e9c5d558ee4d7925e17ed'
	# We init and check the measure ID (C or F or K)
	measure = utils.config('Measure')

	# We search in 'entities' the name of the city
	for item in entities:
		if item['entity'] == 'city' and number_of_cities == 0:
			city = item['sourceText'].lower()
			number_of_cities = 1
		if item['entity'] == 'date':
			date_flag = 1
			date_ref = item['resolution']['date']
			timex_ref = item['resolution']['timex']
			date_ref = date_ref.replace('00:00:00.000', '12:00:00.000')
		if item['entity'] == 'datetime':
			if item['resolution']['values'][0]['timex'] != 'PRESENT_REF':
				date_flag = 1
			date_ref = item['resolution']['values'][0]['value']
			date_mem = date_ref
			hour = int(date_ref[11:13])
			if hour % 3 != 0:
				if hour % 3 == 1:
					hour = hour - 1
					if hour <= 0:
						hour = 3
				elif hour % 3 == 2:
					hour = hour + 1
					if hour >= 24:
						hour = 21
			if hour < 10:
				date_ref = date_ref[:11] + '0'+str(hour)+':00:00'
			else:
				date_ref = date_ref[:11] + str(hour)+':00:00'

	# If he don't found any city
	if city == 'vide0':
		return utils.output('end', 'error', utils.translate('error'))

	date_ref = date_ref.replace('T', ' ')
	date_ref = date_ref[:19]

	if date_flag == 0 or timex_ref == 'PRESENT_REF':
		url = "http://api.openweathermap.org/data/2.5/weather?appid="+API_key+"&q=" + city
		content = requests.get(url)
		data = content.json()

		# Codes error test
		# If it's not '200' we have trouble
		if data['cod'] != 200:
			# If he don't found the city he retry without symbol after the city's name
			if data['cod'] == "404":
				vir = city.find(',')
				es = city.find(' ')
				pt = city.find('.')

				if vir != -1:
					city = city[:vir]
				elif es != -1:
					city = city[:es]
				elif pt != -1:
					city = city[:pt]

				url = "http://api.openweathermap.org/data/2.5/weather?appid="+API_key+"&q=" + city
				content = requests.get(url)
				data = content.json()
				if data['cod'] == "404":
					return utils.output('end', '404_city_not_found', utils.translate('404_city_not_found'))
			# If the number of request is higher than 60/min
			elif data['cod'] == "429":
				return utils.output('end', 'ezy', utils.translate('ezy'))
			else:
				return utils.output('end', 'error', utils.translate('error'))

		t = data['main']['temp']
		sky = data['weather'][0]['description']

		date = time.strftime("%d-%m-%Y", time.localtime())
		hour = time.strftime("%H:%M:%S", time.localtime())

	elif date_flag != 0:
		url = "http://api.openweathermap.org/data/2.5/forecast?appid="+API_key+"&q=" + city
		content = requests.get(url)
		data = content.json()

		# Codes error test (same)
		if data['cod'] != "200":
			if data['cod'] == "404":
				vir = city.find(',')
				es = city.find(' ')
				pt = city.find('.')

				if vir != -1:
					city = city[:vir]
				elif es != -1:
					city = city[:es]
				elif pt != -1:
					city = city[:pt]
				url = "http://api.openweathermap.org/data/2.5/forecast?appid="+API_key+"&q=" + city
				content = requests.get(url)
				data = content.json()
				if data['cod'] == "404":
					return utils.output('end', '404_city_not_found', utils.translate('404_city_not_found'))
			elif data['cod'] == "429":
				return utils.output('end', 'ezy', utils.translate('ezy'))
			else:
				return utils.output('end', 'error', utils.translate('error'))

		flag_w = 0
		i = 0
		while i < 40 and flag_w == 0:
			if data['list'][i]['dt_txt'] == date_ref:
				flag_w = 1
				t = data['list'][i]['main']['temp']
				sky = data['list'][i]['weather'][0]['main']
				datetmp = data['list'][i]['dt_txt']
				if date_mem != 'EMPTY_REF':
					datetmp = date_mem
				date = datetmp[:10]
				hour = datetmp[10:]
			i = i + 1
		if flag_w == 0:
			return utils.output('end', 'error', utils.translate('error'))

	if measure == 'C':
		# Convert in Celsuis
		t = t-273.15
	elif measure == 'F':
		# Convert in Fahrenheit
		t = t*9/5 - 459.67
	t = round(t, 1)

	vir = city.find(',')
	es = city.find(' ')

	if vir != -1:
		city = city[:vir]
	elif es != -1:
		city = city[:es]

	city = city.capitalize()
	sky = sky.lower()
	t = str(t)+'°'+measure

	if date_flag != 0:
		time_indic = '_f'
	else:
		time_indic = '_t'

	return utils.output('end', 'weather'+time_indic, utils.translate('weather'+time_indic, {'cit': city, 'sky': sky, 't': t, 'date': date, 'hour': hour}))
