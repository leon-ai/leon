import os
import sys

IS_RAN_FROM_BINARY = getattr(sys, 'frozen', False)

EXECUTABLE_DIR_PATH = os.path.dirname(sys.executable) if IS_RAN_FROM_BINARY else '.'

LIB_PATH = os.path.join(os.getcwd(), 'tcp_server', 'src', 'lib')
if IS_RAN_FROM_BINARY:
    LIB_PATH = os.path.join(os.path.dirname(sys.executable), 'lib', 'lib')

PYTHON_VERSION = '3.11'

TMP_PATH = os.path.join(LIB_PATH, 'tmp')
AUDIO_MODELS_PATH = os.path.join(os.getcwd(), 'core', 'data', 'models', 'audio')
SETTINGS_PATH = os.path.join(os.getcwd(), 'tcp_server', 'settings.json')

# TTS
TTS_MODEL_FOLDER_PATH = os.path.join(AUDIO_MODELS_PATH, 'tts')
TTS_BERT_FRENCH_MODEL_DIR_PATH = os.path.join(TTS_MODEL_FOLDER_PATH, 'bert-case-french-europeana-cased')
TTS_BERT_BASE_MODEL_DIR_PATH = os.path.join(TTS_MODEL_FOLDER_PATH, 'bert-base-uncased')
TTS_MODEL_CONFIG_PATH = os.path.join(TTS_MODEL_FOLDER_PATH, 'config.json')
IS_TTS_ENABLED = os.environ.get('LEON_TTS', 'true') == 'true'

# ASR
ASR_MODEL_PATH = os.path.join(AUDIO_MODELS_PATH, 'asr')
IS_ASR_ENABLED = os.environ.get('LEON_STT', 'true') == 'true'

# Wake word
WAKE_WORD_MODEL_FOLDER_PATH = os.path.join(AUDIO_MODELS_PATH, 'wake_word')
IS_WAKE_WORD_ENABLED = os.environ.get('LEON_WAKE_WORD', 'true') == 'true'
