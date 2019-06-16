#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
import tmdbsimple as tmdb
import functools
import random as ran
import datetime as dt

# Package database
db = utils.db()['db']

# Query
Query = utils.db()['query']()


def load_config(func):
    @functools.wraps(func)
    def wrapper_load_config(string, entities):
        payload = dict()
        payload["string"] = string
        payload["entities"] = entities
        #  ISO 639-1 language code
        payload["lang"] = utils.getqueryobj()["lang"][:2]
        payload["today"] = dt.date.today()

        payload["API_KEY"] = utils.config('API_KEY')
        tmdb.API_KEY = payload["API_KEY"]

        return func(payload)

    return wrapper_load_config


@load_config
def recommend(payload):
    if db.search(Query.type == 'rmovie_request'):
        payload["movie"] = db.search(Query.type == 'rmovie_request')[0]['content']
        o_id = db.search(Query.type == 'rmovie_request')[0]['old_id']
        o_id = o_id + 1
        db.update({"old_id": o_id}, Query.type == 'rmovie_request')
        db.remove(Query.type == 'rmovie_request' and Query.old_id > 10)
    else:
        # Get an random movie with user's language
        payload["movie"] = tmdb.Discover().movie(
        page=ran.randint(0, 1000),
        language=payload["lang"],
        vote_average_gte=5.00)
        db.insert({'type': 'rmovie_request','old_id': 0, 'content': payload["movie"]})

    movie_nO = ran.randint(0, 20)
    movie = payload["movie"]["results"][movie_nO]
    movie_title = movie["title"]
    movie_rdate = movie["release_date"]
    movie_sum = movie["overview"]

    return utils.output('end', 'recommend', utils.translate('recommend', {
    "movie_title": movie_title,
    "release_date": movie_rdate,
    "summarize": movie_sum}))


@load_config
def now_theatres(payload):
    now_in_theatres = tmdb.Discover().movie(
    primary_release_date=payload["today"],
    language=payload["lang"])
    res = 'The films currently in the cinema are: <br/><ul>'
    for title in now_in_theatres["results"]:
        res = res+"<li>"+title["title"]+"</li>"+"<br/>"
    res = res + "</ul>"

    return utils.output("end", "nit_title_list", utils.translate('nit_list', {
    "nit_title": res
    }))
