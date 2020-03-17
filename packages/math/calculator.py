
from bridges.python import utils

def run(string, entities):
  try:
    numberText = []
    numberList = []
    operatorList = []

    for x in entities:
      numberText.append(x['sourceText'])

    #looks for operators and takes them out
    for x in range(len(numberText)-1):
      number1 = string.find(entities[x]['sourceText'])
      number2 = string.find(entities[x+1]['sourceText'], number1+1)
      operator = string[number1+len(entities[x]['sourceText']):number2]
      operatorList.append(operator.strip())

    #converts operators
    for x in range(len(operatorList)):
      if(operatorList[x].lower() == "plus"):
        operatorList[x] = "+"
      if(operatorList[x].lower() == "minus"):
        operatorList[x] = "-"
      if(operatorList[x].lower() == "divided by"):
        operatorList[x] = "/"
      if(operatorList[x].lower() == "multiplied by"):
        operatorList[x] = "*"

    #makes the equation string
    equation = ""
    for x in range(len(entities)-1):
      if(entities[x+1]['entity'] == 'date'):
        equation += str(entities[x+1]['sourceText'])
      else:
        if(x == 0):
          equation = str(entities[x]['resolution']['value']) + \
              operatorList[x] + str(entities[x+1]['resolution']['value'])
        else:
          equation += operatorList[x] + str(entities[x+1]['resolution']['value'])

    #calculates the equation
    results = eval(equation)

    return utils.output('end', 'test', utils.translate('result', {'equation': equation, 'results': results}))

  except:
    return utils.output('end', 'test', utils.translate('error'))
