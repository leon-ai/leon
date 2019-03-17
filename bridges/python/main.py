#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils
from sys import argv, path
from json import dumps, loads
from importlib import import_module

def main():
	"""Dynamically import modules related to the args and print the ouput"""

	path.append('.')

	queryobj = utils.getqueryobj()
	m = import_module('packages.' + queryobj['package'] + '.' + queryobj['module'])

	return getattr(m, queryobj['module'])(queryobj['query'], queryobj['entities'])

if __name__ == '__main__':
	main()
