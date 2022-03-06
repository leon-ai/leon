#!/usr/bin/env python
# -*- coding:utf-8 -*-

from sys import argv
import spacy

lang = argv[1] or 'en'
spacy_nlp = None
spacy_model_mapping = {
	'en': {
		'model': 'en_core_web_trf',
		'disable': ['tagger', 'parser', 'attribute_ruler', 'lemmatizer'],
		'entity_mapping': {
			'PERSON': 'person',
			'GPE': 'location',
			'ORG': 'organization'
		}
	},
	'fr': {
		'model': 'fr_core_news_md',
		'disable': ['tok2vec', 'morphologizer', 'parser', 'senter', 'attribute_ruler', 'lemmatizer'],
		'entity_mapping': {
			'PER': 'person',
			'LOC': 'location',
			'ORG': 'organization'
		}
	}
}

def load_spacy_model():
	global spacy_nlp

	model = spacy_model_mapping[lang]['model']
	disable = spacy_model_mapping[lang]['disable']

	print(f'Loading {model} spaCy model...')
	spacy_nlp = spacy.load(model, disable=disable)
	print('spaCy model loaded')

def extract_spacy_entities(utterance):
	doc = spacy_nlp(utterance)
	entities = []

	for ent in doc.ents:
		if ent.label_ in spacy_model_mapping[lang]['entity_mapping']:
			entity = spacy_model_mapping[lang]['entity_mapping'][ent.label_]
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
