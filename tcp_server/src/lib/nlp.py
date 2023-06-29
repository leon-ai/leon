from sys import argv
import os
import spacy
import geonamescache

from typing import Union, TypedDict

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


class TimeZone(TypedDict):
    country_code: str
    id: str
    coordinated_universal_time_offset: float
    daylight_saving_time_offset: float


# Extracted from: <https://download.geonames.org/export/dump/timeZones.txt>
time_zones_path = os.path.join(os.path.dirname(__file__), 'time_zones.txt')

time_zones: list[list[str]] = []
with open(time_zones_path, 'r') as file:
    lines = file.read().splitlines()
    for line in lines:
        time_zones.append(line.rstrip().split('\t'))


def get_time_zone_data(time_zone_id: str) -> Union[TimeZone, None]:
    time_zone_data: Union[TimeZone, None] = None
    for time_zone in time_zones:
        if time_zone[1] == time_zone_id:
            time_zone_data = {
                'country_code': time_zone[0],
                'id': time_zone[1],
                'coordinated_universal_time_offset': float(time_zone[2]),
                'daylight_saving_time_offset': float(time_zone[3])
            }
            break
    return time_zone_data


"""
Functions called from TCPServer class
"""


def load_spacy_model():
    global spacy_nlp

    model = spacy_model_mapping[lang]['model']
    exclude = spacy_model_mapping[lang]['exclude']

    print(f'Loading {model} spaCy model...')
    spacy_nlp = spacy.load(model, exclude=exclude)
    print('spaCy model loaded')


def extract_spacy_entities(utterance):
    doc = spacy_nlp(utterance)
    entities = []

    for ent in doc.ents:
        if ent.label_ in spacy_model_mapping[lang]['entity_mapping']:
            entity = spacy_model_mapping[lang]['entity_mapping'][ent.label_]
            resolution = {
                'value': ent.text
            }

            if entity == 'location':
                for country in countries:
                    if countries[country]['name'].casefold() == ent.text.casefold():
                        entity += ':country'
                        resolution['data'] = countries[country]
                        break

                for city in cities:
                    if cities[city]['name'].casefold() == ent.text.casefold():
                        entity += ':city'
                        resolution['data'] = cities[city]
                        resolution['data']['time_zone'] = get_time_zone_data(cities[city]['timezone'])
                        break

            entities.append({
                'start': ent.start_char,
                'end': ent.end_char,
                'len': len(ent.text),
                'sourceText': ent.text,
                'utteranceText': ent.text,
                'entity': entity,
                'resolution': resolution
            })

    return entities
