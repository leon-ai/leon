#!/usr/bin/env python
# -*- coding:utf-8 -*-

import akinator

import utils

aki = akinator.Akinator()


def new_game(string, entities):
    q = aki.start_game(utils.config("lang"))
    utils.output(
        "inter",
        "question",
        utils.translate(
            "question",
            {"question": q}
        )
    )


def answer(string, entities):
    if string == "Yes" or string == "No" or string == "I don't know":
        q = aki.answer(string)
        if aki.progression > 90:
            aki.win()

            utils.output(
                "end",
                "result",
                utils.translate(
                    "result",
                    {
                        "name": aki.name,
                        "description": aki.description,
                        "picture": aki.picture
                    }
                )
            )
        else:
            utils.output(
                "inter",
                "question",
                utils.translate(
                    "question",
                    {"question": q}
                )
            )
    else:
        utils.output(
            "inter",
            "invalid_answer",
            utils.translate(
                "invalid_answer"
            )
        )


def back(string, entities):
    try:
        q = aki.back()
        utils.output(
            "inter",
            "question",
            utils.translate(
                "question",
                {"question": q}
            )
        )
    except akinator.CantGoBackAnyFurther:
        utils.output(
            "inter",
            "cant_go_back_any_further",
            utils.translate(
                "cant_go_back_any_further"
            )
        )
        pass
