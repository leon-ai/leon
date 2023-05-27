# Questions are taken from: http://www.lrjj.cn/encrm1.0/public/upload/MBTI-personality-test.pdf

from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from ..lib import memory

from typing import Union

groups = [
    {
        'name': 'mind',
        'a': 'E',  # Extraverted
                'b': 'I',  # Introverted
                'questions': [1, 5, 9, 13, 17]
    },
    {
        'name': 'energy',
        'a': 'S',  # Sensing
                'b': 'N',  # Intuitive
                'questions': [2, 6, 10, 14, 18]
    },
    {
        'name': 'nature',
        'a': 'T',  # Thinking
                'b': 'F',  # Feeling
                'questions': [3, 7, 11, 15, 19]
    },
    {
        'name': 'tactics',
        'a': 'J',  # Judging
                'b': 'P',  # Perceiving
                'questions': [4, 8, 12, 16, 20]
    }
]


def run(params: ActionParams) -> None:
    """Loop over the questions and track choices"""

    resolvers = params['resolvers']
    choice = None
    letter: Union[memory.Letter, None] = None  # E I S N T F

    for resolver in resolvers:
        if resolver['name'] == 'form':
            choice = resolver['value']

    # Return no speech if no value has been found
    if choice is None:
        return leon.answer({'core': {'isInActionLoop': False}})

    question, choice = choice.split('_')

    session = memory.get_session()
    current_question = session['current_question']
    next_question = current_question + 1

    # Define the letter to increment
    for group in groups:
        if current_question in group['questions']:
            letter = group[choice]

    if letter is not None:
        memory.increment_letter_score(letter)
    memory.upsert_session(next_question)

    # Release final result
    if current_question == 20:
        session_result = memory.get_session()
        type_arr = []

        for group in groups:
            group_letter = group['a'] if session_result[group['a']] >= session_result[group['b']] else group['b']
            type_arr.append(group_letter)

        final_type = ''.join(type_arr)

        return leon.answer({
            'key': 'result',
            'data': {
                'type': final_type,
                'type_url': final_type.lower()
            },
            'core': {
                'isInActionLoop': False
            }
        })

    return leon.answer({
        'key': str(next_question),
        'data': {
            'question': str(next_question)
        }
    })
