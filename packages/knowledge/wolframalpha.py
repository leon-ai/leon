#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils

from urllib.error import URLError

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
            try:
                res = client.query(entity["sourceText"])
            except URLError:
                return utils.output(
                    "end",
                    "connection_error",
                    utils.translate("connection_error")
                )

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
