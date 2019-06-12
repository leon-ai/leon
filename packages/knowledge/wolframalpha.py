#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

import wolframalpha

client = wolframalpha.Client(utils.config("app_id"))


def query(strings, entities):
    utils.output(
        "inter",
        "acquiring",
        utils.translate("acquiring")
    )

    for entity in entities:
        if entity["entity"] == "query":
            res = client.query(entity["sourceText"])

            return utils.output(
                "end",
                "result",
                utils.translate("result", {"result": next(res.results).text})
            )

    return utils.output(
        "end",
        "no_query",
        utils.translate("no_query")
    )
