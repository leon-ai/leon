import utils


def replay(params):
    """Take decision about whether to replay"""

    resolvers = params['resolvers']
    decision = False

    for resolver in resolvers:
        if resolver['name'] == 'affirmation_denial':
            decision = resolver['value']

    if decision:
        return utils.output('end', 'replay', {
            'isInActionLoop': False,
            'restart': True
        })

    return utils.output('end', 'stop', {'isInActionLoop': False})
