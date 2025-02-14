import socket
import json
import os
from typing import Union
import time
import re
import threading

import lib.nlp as nlp
from .utils import get_settings
from .wake_word.api import WakeWord
from .asr.api import ASR
from .tts.api import TTS
from .constants import (
    TTS_MODEL_CONFIG_PATH,
    TTS_MODEL_FOLDER_PATH,
    WAKE_WORD_MODEL_FOLDER_PATH,
    IS_WAKE_WORD_ENABLED,
    IS_TTS_ENABLED,
    TMP_PATH,
    IS_ASR_ENABLED
)

TTS_MODEL_PATH = os.path.join(TTS_MODEL_FOLDER_PATH, get_settings('tts')['model_file_name'])


class TCPServer:
    def __init__(self, host: str, port: Union[str, int]):
        self.host = host
        self.port = port
        self.tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.conn = None
        self.addr = None
        self.wake_word = None
        self.tts = None
        self.asr = None
        self.asr_recording_thread = None

    @staticmethod
    def log(*args, **kwargs):
        print('[TCP Server]', *args, **kwargs)

    def send_tcp_message(self, data: dict):
        if not self.conn:
            self.log('No client connection found. Cannot send message')
            return

        self.conn.sendall(json.dumps(data).encode('utf-8'))

    def init_tts(self):
        if not IS_TTS_ENABLED:
            self.log('TTS is disabled')
            return

        if not os.path.exists(TTS_MODEL_CONFIG_PATH):
            self.log(f'TTS model config not found at {TTS_MODEL_CONFIG_PATH}')
            return

        if not os.path.exists(TTS_MODEL_PATH):
            self.log(f'TTS model not found at {TTS_MODEL_PATH}')
            return

        self.tts = TTS(language='EN',
                       device=get_settings('tts')['device'],
                       config_path=TTS_MODEL_CONFIG_PATH,
                       ckpt_path=TTS_MODEL_PATH)

    def init_asr(self):
        if not IS_ASR_ENABLED:
            self.log('ASR is disabled')
            return

        def transcribed_callback(text):
            # cleaned_text = clean_up_speech(text)
            self.log('Cleaned speech:', text)
            self.send_tcp_message({
                'topic': 'asr-new-speech',
                'data': {
                    'text': text
                }
            })

        def interrupt_leon_speech_callback():
            self.log('Interrupting Leon speech because owner started speaking')
            self.send_tcp_message({
                'topic': 'asr-interrupt-leon-speech',
                'data': {}
            })

        def end_of_owner_speech_callback(utterance):
            self.log('End of owner speech:', utterance)
            self.send_tcp_message({
                'topic': 'asr-end-of-owner-speech-detected',
                'data': {
                    'utterance': utterance
                }
            })

        def active_listening_disabled_callback():
            self.log('Active listening disabled')
            self.send_tcp_message({
                'topic': 'asr-active-listening-disabled',
                'data': {}
            })

        self.asr = ASR(tcp_server=self,
                       device=get_settings('asr')['device'],
                       interrupt_leon_speech_callback=interrupt_leon_speech_callback,
                       transcribed_callback=transcribed_callback,
                       end_of_owner_speech_callback=end_of_owner_speech_callback,
                       active_listening_disabled_callback=active_listening_disabled_callback)

        if not IS_WAKE_WORD_ENABLED:
            self.log('Wake word is disabled')
            return

        wake_word_model_name = get_settings('wake_word')['model_file_name']
        wake_word_model_path = os.path.join(WAKE_WORD_MODEL_FOLDER_PATH, wake_word_model_name)

        self.asr.wake_word = WakeWord(
            asr=self.asr,
            model_path=wake_word_model_path,
            device=get_settings('wake_word')['device'],
            detection_threshold=get_settings('wake_word')['detection_threshold']
        )
        # Do not add anything after this line because it will be ignored
        # as it loops for the wake word
        self.asr.wake_word.start_listening()

    def init(self):
        try:
            # Make sure to establish TCP connection by reusing the address so it does not conflict with port already in use
            self.tcp_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            self.tcp_socket.bind((self.host, int(self.port)))
            self.tcp_socket.listen()
        except OSError as e:
            # If the port is already in use, close the connection and retry
            if 'Address already in use' in str(e):
                self.log(f'Port {self.port} is already in use. Disconnecting client and retrying...')
                if self.conn:
                    self.conn.close()
                # Wait for a moment before retrying
                time.sleep(1)
                self.init()
            else:
                raise

        while True:
            # Flush buffered output to make it IPC friendly (readable on stdout)
            self.log('Waiting for connection...', flush=True)

            # Our TCP server only needs to support one connection
            self.conn, self.addr = self.tcp_socket.accept()

            try:
                self.log(f'Client connected: {self.addr}')

                while True:
                    # socket_data = self.conn.recv(1024)
                    socket_data = self.conn.recv(8096)

                    if not socket_data:
                        break

                    data_dict = json.loads(socket_data)

                    # Verify the received topic can execute the method
                    method = data_dict['topic'].lower().replace('-', '_')
                    if hasattr(self.__class__, method) and callable(getattr(self.__class__, method)):
                        data = data_dict['data']
                        method = getattr(self, method)
                        res = method(data)

                        self.send_tcp_message(res)
                    else:
                        self.log(f'Method "{method}" not found')
            finally:
                self.log(f'Client disconnected: {self.addr}')
                self.conn.close()

    def get_spacy_entities(self, utterance: str) -> dict:
        entities = nlp.extract_spacy_entities(utterance)

        return {
            'topic': 'spacy-entities-received',
            'data': {
                'spacyEntities': entities
            }
        }

    def asr_start_recording(self, extra=None) -> dict:
        # If ASR is not initialized yet, then wait for 2 seconds before starting recording
        if not self.asr:
            self.log('ASR is not initialized yet. Waiting for 2 seconds before starting recording...')
            time.sleep(2)

        if self.asr.is_recording is False:
            self.asr_recording_thread = threading.Thread(target=self.asr.start_recording)
            self.asr_recording_thread.start()

        return {
            'topic': 'asr-started-recording',
            'data': {}
        }

    def tts_synthesize(self, speech: str) -> dict:
        # If TTS is not initialized yet, then wait for 2 seconds before synthesizing
        if not self.tts:
            self.log('TTS is not initialized yet. Waiting for 2 seconds before synthesizing...')
            time.sleep(2)

        """
        TODO:
        - Implement one speaker per style (joyful, sad, angry, tired, etc.)
        - Need to train a new model with default voice speaker and other speakers with different styles
        - EN-Leon-Joyful-V1; EN-Leon-Sad-V1; etc.
        """
        speaker_ids = self.tts.hps.data.spk2id
        # Random file name to avoid conflicts
        audio_id = f'{int(time.time())}_{os.urandom(2).hex()}'
        output_file_name = f'{audio_id}.wav'
        output_path = os.path.join(TMP_PATH, output_file_name)
        speed = 1

        formatted_speech = speech.replace(' - ', '.').replace(',', '.').replace(': ', '. ')
        # Clean up emojis
        formatted_speech = re.sub(r'[\U00010000-\U0010ffff]', '', formatted_speech)
        formatted_speech = formatted_speech.strip()
        # formatted_speech = speech.replace(',', '.').replace('.', '...')

        # TODO: should not wait to finish for streaming support
        self.tts.tts_to_file(
            formatted_speech,
            speaker_ids['EN-Leon-V1_1'],
            output_path=output_path,
            speed=speed,
            quiet=True,
            format='wav',
            stream=False
        )

        return {
            'topic': 'tts-audio-streaming',
            'data': {
                'outputPath': output_path,
                'audioId': audio_id
            }
        }

    def leon_speech_audio_ended(self, audio_duration: float) -> dict:
        if not self.asr:
            self.log('ASR is None, cannot update active listening duration')

        if self.asr:
            if not audio_duration:
                audio_duration = 0
            self.asr.active_listening_duration = self.asr.base_active_listening_duration + audio_duration
            self.log(f'ASR active listening duration increased to {self.asr.active_listening_duration}s')

        return {
            'topic': 'asr-active-listening-duration-increased',
            'data': {
                'activeListeningDuration': self.asr.active_listening_duration
            }
        }
