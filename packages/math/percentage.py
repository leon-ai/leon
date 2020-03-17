
from bridges.python import utils

def run(string, entities):
  try:
    percent = entities[0]['resolution']['value']
    value = entities[1]['resolution']['value']

    percent = percent/100

    result = percent * value

    return utils.output('end', 'test', utils.translate('result', {'result': result}))
  except:
    return utils.output('end', 'test', utils.translate('error'))
    
