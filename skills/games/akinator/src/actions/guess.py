#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from ..lib import akinator

def guess(params):
    aki = akinator.Akinator()

    q = aki.start_game('en')

    i = 0
    while i <= 2:
    	i += 1
    	utils.output('end', 'ook')

    """ while aki.progression <= 80:
    	# a = input(q + "\n\t")
    	return utils.output('end', q) """

    """ while aki.progression <= 80:
        a = input(q + "\n\t")
        if a == "b":
            try:
                q = aki.back()
            except akinator.CantGoBackAnyFurther:
                pass
        else:
            q = aki.answer(a)
    aki.win()

    correct = input(f"It's {aki.first_guess['name']} ({aki.first_guess['description']})! Was I correct?\n{aki.first_guess['absolute_picture_path']}\n\t")
    if correct.lower() == "yes" or correct.lower() == "y":
        print("Yay\n")
    else:
        print("Oof\n") """
