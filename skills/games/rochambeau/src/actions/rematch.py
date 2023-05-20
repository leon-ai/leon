#!/usr/bin/env python
# -*- coding:utf-8 -*-

import utils


def rematch(params):
    """Take decision whether to do a rematch"""

    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        return utils.output('end', 'confirm_rematch', {
            'isInActionLoop': False,
            'restart': True
        })

    return utils.output('end', 'deny_rematch', {'isInActionLoop': False})
