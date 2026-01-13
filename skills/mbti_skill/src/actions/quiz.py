# Questions are taken from: http://www.lrjj.cn/encrm1.0/public/upload/MBTI-personality-test.pdf

from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.network import Network
from ..lib import memory
import os

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
    """Loop over the questions and track choices using LLM to interpret the user's utterance."""

    session = memory.get_session()
    current_question = session['current_question']
    network = Network({
        'base_url': f"{os.environ.get('LEON_HOST')}:{os.environ.get('LEON_PORT')}/api/v1"
    })

    # If waiting for user's answer (not starting/continuing quiz)
    if params['utterance'] and current_question <= 20:
        # Get current question text for context
        question_text = leon.set_answer_data(str(current_question), {
            'question': current_question
        })
        # Compose prompt for LLM to classify answer
        system_prompt = (
            "You are an MBTI quiz bot. "
            "Classify the user's response to the given MBTI question. "
            "\nChoose 'a' or 'b' based on user's answer, ONLY reply with 'a' or 'b'."
        )
        prompt = f"User's response: {params['utterance']}\nQuestion: {question_text}"
        thought_tokens_budget = 64
        response = network.request({
            'url': '/llm-inference',
            'method': 'POST',
            'data': {
                'dutyType': 'custom',
                'input': prompt,
                'data': {
                    'system_prompt': system_prompt,
                    'thought_tokens_budget': thought_tokens_budget,
                    # Thinking budget and enough for actual output
                    'max_tokens': thought_tokens_budget + 8
                }
            }
        })
        llm_classification = response['data']['output'].strip().lower()
        # Determine the corresponding letter and increment it
        answer_letter = None
        for group in groups:
            if current_question in group['questions']:
                if llm_classification == 'a':
                    answer_letter = group['a']
                elif llm_classification == 'b':
                    answer_letter = group['b']

        if answer_letter:
            memory.increment_letter_score(answer_letter)

        memory.upsert_session(current_question + 1)
        next_question = current_question + 1

        # If quiz finished:
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
                    'is_in_action_loop': False
                }
            })

        # Send next question
        return leon.answer({
            'key': str(next_question),
            'data': {
                'question': next_question
            }
        })

    # If just starting quiz, send first question
    if current_question <= 20:
        return leon.answer({
            'key': str(current_question),
            'data': {
                'question': current_question
            }
        })
