#!/usr/bin/env python
# -*- coding:utf-8 -*-

from os import path
from json import loads

packagejsonfile = open(path.dirname(path.realpath(__file__)) + '/../../../../package.json', 'r', encoding = 'utf8')
packagejson = loads(packagejsonfile.read())
packagejsonfile.close()

useragent = 'Leon-Personal-Assistant/' + packagejson['version']
