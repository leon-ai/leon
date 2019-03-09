#!/usr/bin/env python
# -*- coding:utf-8 -*-

# The SpeedTest package will give you information about your network speed
# Author: Florian Bouché
# Date: 2019-03-09
# Based on the package https://github.com/sivel/speedtest-cli

import utils
import os
import sys
import subprocess


def speedtest(string):
  """The SpeedTest package will give you information about your network speed """

  utils.output('inter', 'start', utils.translate('start'))

  realpath = os.path.dirname(os.path.realpath(__file__))
  process = subprocess.Popen(
    [sys.executable, realpath + '\speedtest.lib.py', '--simple'],
    shell=True,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT
  )

  (output, err) = process.communicate()
  p_status = process.wait()

  if err:
    utils.output('end', 'error', utils.translate('error'))

  utils.output('inter', 'end', utils.translate('end'))

  return utils.output('end', 'test', output.decode('utf-8'))
