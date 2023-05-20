import random
import sys
from time import sleep

from ..constants import SKILL_SRC_CONFIG, SKILL_CONFIG

class Leon:
	instance: 'Leon' = None

	def __init__(self) -> None:
		if not Leon.instance:
			Leon.instance = self

	def get_src_config(key: str = None):
		"""
		Get source configuration
		"""
        try:
            if key:
                return SKILL_SRC_CONFIG[key]

            return SKILL_SRC_CONFIG
        except Exception as e:
            print('Error while getting source configuration:', e)
            return {}

	def set_answer_data(answer_key: str, data = None):
		"""
		Apply data to the answer
		"""
        if answer_key:
            try:
                # In case the answer key is a raw answer
                if SKILL_CONFIG.get('answers') is None or SKILL_CONFIG['answers'].get(answer_key) is None:
                    return answer_key

                answers = SKILL_CONFIG['answers'].get(answer_key, '')
                if isinstance(answers, list):
                    answer = answers[random.randrange(len(answers))]
                else:
                    answer = answers

                if data:
                    for key, value in data.items():
                        # In case the answer needs speech and text differentiation
                        if not isinstance(answer, str) and answer.get('text'):
                            answer['text'] = answer['text'].replace('%{}%'.format(key), str(value))
                            answer['speech'] = answer['speech'].replace('%{}%'.format(key), str(value))
                        else:
                            answer = answer.replace('%{}%'.format(key), str(value))

                if SKILL_CONFIG.get('variables'):
                    for key, value in SKILL_CONFIG['variables'].items():
                        # In case the answer needs speech and text differentiation
                        if not isinstance(answer, str) and answer.get('text'):
                            answer['text'] = answer['text'].replace('%{}%'.format(key), str(value))
                            answer['speech'] = answer['speech'].replace('%{}%'.format(key), str(value))
                       else:
                            answer = answer.replace('%{}%'.format(key), str(value))

                return answer
           except Exception as e:
               print('Error while setting answer data:', e)

               return None

        return None

    def answer(answer_input):
    	"""
    	Send an answer to the core
    	"""
        try:
            output = {
                'output': {
                    'codes': 'widget' if answer_input.get('widget') and not answer_input.get('key') else answer_input.get('key'),
                    'answer': self.set_answer_data(answer_input.get('key'), answer_input.get('data')) or '',
                    'core': answer_input.get('core'),
                    'options': self.get_src_config('options')
                }
            }

            if answer_input.get('widget'):
                output['output']['widget'] = answer_input['widget']

            answer_object = {
                 **INTENT_OBJECT,
                 **output
            }

            # Temporize for the data buffer output on the core
            sleep(0.1)

            sys.stdout.write(json.dumps(answer_object))

        except Exception as e:
            print('Error while creating answer:', e)

leon = Leon()
