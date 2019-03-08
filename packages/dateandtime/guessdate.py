#!/usr/bin/env python
# -*- coding:utf-8 -*-

import requests
import utils
import datetime
import parsedatetime
# import dateparser
from random import randint

def guessdate(word):

  word = word.lstrip()
  if word.startswith('the'):
    word = word.replace('the', 'one', 1)

  cal = parsedatetime.Calendar()
  time_struct, parse_status = cal.parse(word)
  guess =  datetime.datetime(*time_struct[:6])
  day = guess.day
  time = datetime.datetime.time(guess)
  random = randint(0, 2)

  # https://stackoverflow.com/questions/9647202/ordinal-numbers-replacement
  suf = lambda n: "%d%s"%(n,{1:"st",2:"nd",3:"rd"}.get(n if n<20 else n%10,"th"))

  if random == 0:
    return utils.output('end', 'guess', utils.translate('guess', { 'guess': "The " + suf(day) + ' of ' + '{:%B}'.format(guess) + ', {:%Y}'.format(guess)}))
  elif random == 1:
    return utils.output('end', 'guess', utils.translate('guess', { 'guess': '{:%B}'.format(guess) + ' the ' + suf(day) + ', {:%Y}'.format(guess)}))
  else:
    return utils.output('end', 'guess', utils.translate('guess', { 'guess': suf(day) + ' of ' '{:%B}'.format(guess) + ', {:%Y}'.format(guess)}))


  #trying to use dateparser lib
  # return utils.output('end', 'guess', utils.translate('guess', { 'guess': dateparser.parse(word) }))
