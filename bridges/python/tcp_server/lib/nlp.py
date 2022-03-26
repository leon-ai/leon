#!/usr/bin/env python
# -*- coding:utf-8 -*-

from sys import argv
import spacy
import geonamescache

lang = argv[1] or 'en'
spacy_nlp = None
spacy_model_mapping = {
	'en': {
		'model': 'en_core_web_trf',
		'exclude': ['tagger', 'parser', 'attribute_ruler', 'lemmatizer'],
		'entity_mapping': {
			'PERSON': 'person',
			'GPE': 'location',
			'ORG': 'organization'
		}
	},
	'fr': {
		'model': 'fr_core_news_md',
		'exclude': ['tok2vec', 'morphologizer', 'parser', 'senter', 'attribute_ruler', 'lemmatizer'],
		'entity_mapping': {
			'PER': 'person',
			'LOC': 'location',
			'ORG': 'organization'
		}
	}
}

gc = geonamescache.GeonamesCache()
countries = gc.get_countries()
cities = gc.get_cities()

def gen_dict_extract(var, key):
	if isinstance(var, dict):
		for k, v in var.items():
			if k == key:
				yield v
			if isinstance(v, (dict, list)):
				yield from gen_dict_extract(v, key)
	elif isinstance(var, list):
		for d in var:
			yield from gen_dict_extract(d, key)

countries = [*gen_dict_extract(countries, 'name')]
cities = [*gen_dict_extract(cities, 'name')]

"""
Functions called from TCPServer class
"""

def load_spacy_model():
	global spacy_nlp

	model = spacy_model_mapping[lang]['model']
	exclude = spacy_model_mapping[lang]['exclude']

	print(f'Loading {model} spaCy model...')
	spacy_nlp = spacy.load(model, exclude=exclude)
	# spacy_nlp = spacy.load(Path('../models/spacy_en_core_web_trf-3.2.0'), disable=disable)
	# spacy_nlp = spacy.load(Path('../models/spacy_en_core_web_trf-3.2.0'), disable=disable)
	print('spaCy model loaded')

def extract_spacy_entities(utterance):
	doc = spacy_nlp(utterance)
	entities = []

	for ent in doc.ents:
		if ent.label_ in spacy_model_mapping[lang]['entity_mapping']:
			entity = spacy_model_mapping[lang]['entity_mapping'][ent.label_]
			if entity == 'location':
				if ent.text.casefold() in (country.casefold() for country in countries):
					entity += ':country'
				elif ent.text.casefold() in (city.casefold() for city in cities):
					entity += ':city'

			entities.append({
				'start': ent.start_char,
				'end': ent.end_char,
				'len': len(ent.text),
				'sourceText': ent.text,
				'utteranceText': ent.text,
				'entity': entity,
				'resolution': {
					'value': ent.text
				}
			})

	return entities
