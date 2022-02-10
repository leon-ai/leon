#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from sys import argv, path
from json import dumps, loads
from importlib import import_module

def main():
	"""Dynamically import modules related to the args and print the ouput"""

	path.append('.')

	intent_obj = utils.get_intent_obj()
	m = import_module('packages.' + intent_obj['package'] + '.' + intent_obj['module'])

	return getattr(m, intent_obj['action'])(intent_obj['utterance'], intent_obj['entities'])

if __name__ == '__main__':
	main()
