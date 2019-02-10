#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from sys import argv, path
from json import dumps
from importlib import import_module

def main():
	"""Dynamically import modules related to the args and print the ouput"""

	path.append('.')

	lang = argv[1]
	package = argv[2]
	module = argv[3]
	string = argv[4]
	m = import_module('packages.' + package + '.' + module)

	return getattr(m, module)(string)

if __name__ == '__main__':
	main()
