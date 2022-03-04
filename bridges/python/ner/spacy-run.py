#!/usr/bin/env python
# -*- coding:utf-8 -*-

import spacy
nlp = spacy.load("en_core_web_trf", disable=["tagger", "parser", "attribute_ruler", "lemmatizer"])
# nlp = spacy.load("en_core_web_md", disable=["tok2vec", "tagger", "parser", "attribute_ruler", "lemmatizer"])

doc = nlp("Do you know Spotify? I live in Paris and I'm Matthieu")

for ent in doc.ents:
    print(ent.text, ent.label_)
