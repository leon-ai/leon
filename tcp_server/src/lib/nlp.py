import copy
from sys import argv
import spacy
from geonamescache import GeonamesCache

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

geonamescache = GeonamesCache()
countries = geonamescache.get_countries()
cities = geonamescache.get_cities()

"""
Functions called from TCPServer class
"""


def load_spacy_model() -> None:
    global spacy_nlp

    model = spacy_model_mapping[lang]['model']
    exclude = spacy_model_mapping[lang]['exclude']

    print(f'Loading {model} spaCy model...')
    spacy_nlp = spacy.load(model, exclude=exclude)
    print('spaCy model loaded')


def delete_unneeded_country_data(data: dict) -> None:
    try:
        del data['geonameid']
        del data['neighbours']
        del data['languages']
        del data['iso3']
        del data['fips']
        del data['currencyname']
        del data['postalcoderegex']
        del data['areakm2']
    except BaseException:
        pass


def extract_spacy_entities(utterance: str) -> list[dict]:
    doc = spacy_nlp(utterance)
    entities: list[dict] = []

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
                        resolution['data'] = copy.deepcopy(countries[country])
                        delete_unneeded_country_data(resolution['data'])
                        break

                city_population = 0
                for city in cities:
                    alternatenames = [name.casefold() for name in cities[city]['alternatenames']]
                    if cities[city]['name'].casefold() == ent.text.casefold() or ent.text.casefold() in alternatenames:
                        if city_population == 0:
                            entity += ':city'

                        if cities[city]['population'] > city_population:
                            resolution['data'] = copy.deepcopy(cities[city])
                            city_population = cities[city]['population']

                            for country in countries:
                                if countries[country]['iso'] == cities[city]['countrycode']:
                                    resolution['data']['country'] = copy.deepcopy(countries[country])
                                    break
                            try:
                                del resolution['data']['geonameid']
                                del resolution['data']['alternatenames']
                                del resolution['data']['admin1code']
                                delete_unneeded_country_data(resolution['data']['country'])
                            except BaseException:
                                pass
                        else:
                            continue

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
