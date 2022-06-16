#!/usr/bin/env python
# -*- coding:utf-8 -*-

from random import randint

import utils
from ..lib import db

def setup(params):
	"""Init the the number to guess"""

	nb = randint(1, 100)

	db.create_new_game(nb)

	return utils.output('end', 'ready')
