#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from sys import argv, path
from json import dumps, loads
from importlib import import_module

def main():
	"""Dynamically import skills related to the args and print the output"""

	path.append('.')

	intent_obj = utils.get_intent_obj()

	skill = import_module('skills.' + intent_obj['domain'] + '.' + intent_obj['skill'] + '.src.actions.' + intent_obj['action'])

	return getattr(skill, intent_obj['action'])(intent_obj['utterance'], intent_obj['entities'])

if __name__ == '__main__':
	main()
