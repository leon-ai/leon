#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
import datetime
from random import randint

def saycurrenttime(string):

  # https://sukhbinder.wordpress.com/2013/12/29/time-in-words-with-python/
  time = datetime.datetime.now()

  if randint(0, 1) != 0:
    words = [
      "one", "two", "three", "four", "five", "six", "seven", "eight","nine",
      "ten", "eleven", "twelve", "thirteen", "fourteen", "quarter", "sixteen",
      "seventeen", "eighteen", "nineteen", "twenty", "twenty one",
      "twenty two", "twenty three", "twenty four", "twenty five",
      "twenty six", "twenty seven", "twenty eight", "twenty nine", "half"
    ]

    hrs = time.hour
    mins = time.minute
    msg = ""

    if (hrs > 12):
        hrs = hrs-12
    if (mins == 0):
        hr = words[hrs-1]
        msg = hr + " o'clock."
    elif (mins < 31):
            hr = words[hrs-1]
            mn = words[mins-1]
            msg = mn + " past " + hr + "."
    else:
        hr = words[hrs]
        mn = words[(60 - mins-1)]
        msg = mn + " to " + hr + "."
    return utils.output('end', 'time', utils.translate('time', { 'time':  msg }))

  return utils.output('end', 'time', utils.translate('time', { 'time': 'exactly ' + '{:%H:%M:%S}'.format(time) }))


