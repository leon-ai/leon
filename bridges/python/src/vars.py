#!/usr/bin/env python
# -*- coding:utf-8 -*-

import sys
import os
from json import loads

packagejsonfile = open(os.path.join(os.getcwd(), 'package.json'), 'r', encoding = 'utf8')
packagejson = loads(packagejsonfile.read())
packagejsonfile.close()

useragent = 'Leon-Personal-Assistant/' + packagejson['version']
