#!/usr/bin/env python
# -*- coding:utf-8 -*-

import wikipedia
from wikipedia.exceptions import DisambiguationError, PageError
from requests.exceptions import ConnectionError

import utils

wikipedia.set_lang(utils.config("lang"))


def summary(string, entities):
    """
    Get the summary of the requested Wikipedia page.
    """

    for entity in entities:
        if entity["entity"] == "page":
            utils.output(
                "inter",
                "acquiring",
                utils.translate("acquiring")
            )

            try:
                summary = wikipedia.summary(
                    entity["sourceText"],
                    sentences=utils.config("sentences")
                )
                return utils.output(
                    "end",
                    "summary",
                    utils.translate(
                        "summary",
                        {"summary": summary}
                    )
                )

            except DisambiguationError as pages:
                # TODO: ask which page to visit
                return utils.output(
                    "end",
                    "disambiguation_error",
                    utils.translate("disambiguation_error")
                )

            except PageError:
                return utils.output(
                    "end",
                    "page_error",
                    utils.translate("page_error")
                )

            except ConnectionError:
                return utils.output(
                    "end",
                    "connection_error",
                    utils.translate("connection_error")
                )

    return utils.output(
        "end",
        "no_entities_error",
        utils.translate("no_entities_error")
    )


def random(string, entities):
    """
    Get the summary of a random Wikipedia page.
    """
    utils.output(
        "inter",
        "acquiring",
        utils.translate("acquiring")
    )
    try:
        summary = wikipedia.summary(title=wikipedia.random())
    except ConnectionError:
        return utils.output(
            "end",
            "connection_error",
            utils.translate("connection_error")
        )

    return utils.output(
        "end",
        "summary",
        utils.translate(
            "summary",
            {"summary": summary}
        )
    )
