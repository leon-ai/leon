import pyaudio
import audioop
import time
import torch
import numpy as np
from faster_whisper import WhisperModel

from ..constants import ASR_MODEL_PATH
from ..utils import ThrottledCallback, is_macos, get_settings


class ASR:
    def __init__(self,
                 tcp_server=None,
                 # @see https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/transcribe.py
                 # auto, cpu, cuda
                 device='auto',
                 interrupt_leon_speech_callback=None,
                 transcribed_callback=None,
                 end_of_owner_speech_callback=None,
                 active_listening_disabled_callback=None):
        tic = time.perf_counter()
        self.log('Loading model...')

        if device == 'auto':
            if torch.cuda.is_available():
                device = 'cuda'
                self.log('Using CUDA (Compute Unified Device Architecture)')

        if 'cuda' in device:
            assert torch.cuda.is_available()

        self.log(f'Device: {device}')

        compute_type = 'float16'
        if is_macos():
            compute_type = 'int8_float32'

        if device == 'cpu':
            compute_type = 'int8_float32'

        self.tcp_server = tcp_server
        self.wake_word = None
        self.compute_type = compute_type
        self.is_recording = False

        """
        Thottle the interrupt Leon's speech callback to avoid sending too many messages to the client
        """
        self.interrupt_leon_speech_callback = ThrottledCallback(
            interrupt_leon_speech_callback, 0.8
        )
        self.transcribed_callback = transcribed_callback
        self.end_of_owner_speech_callback = end_of_owner_speech_callback
        self.active_listening_disabled_callback = active_listening_disabled_callback

        self.device = device
        self.is_voice_activity_detected = False
        self.silence_start_time = 0
        self.is_active_listening_enabled = False
        self.complete_text = ''

        self.audio_format = pyaudio.paInt16
        self.buffer = bytearray()
        self.silence_frames_count = 0
        self.channels = 1
        self.rate = 16000
        self.frames_per_buffer = 1024
        self.rms_threshold = get_settings('asr')['rms_mic_threshold']
        # Duration of silence after which the audio data is considered as a new utterance (in seconds)
        self.silence_duration = get_settings('asr')['silence_duration']
        """
        Duration of silence after which the active listening is stopped (in seconds).
        Once stopped, the active listening can be resumed by starting a new recording event
        """
        self.base_active_listening_duration = get_settings('asr')['active_listening_duration']
        self.active_listening_duration = self.base_active_listening_duration

        self.audio = pyaudio.PyAudio()
        self.mic_stream = None
        self.model = None

        model_params = {
            'model_size_or_path': ASR_MODEL_PATH,
            'device': self.device,
            'compute_type': self.compute_type,
            'local_files_only': True
        }
        if self.device == 'cpu':
            model_params['cpu_threads'] = 4

        self.open_mic_stream()

        self.model = WhisperModel(**model_params)

        self.log('Model loaded')
        toc = time.perf_counter()

        self.log(f'Time taken to load model: {toc - tic:0.4f} seconds')

    def open_mic_stream(self):
        try:
            self.mic_stream = self.audio.open(format=self.audio_format,
                                              channels=self.channels,
                                              rate=self.rate,
                                              frames_per_buffer=self.frames_per_buffer,
                                              input=True,
                                              input_device_index=self.audio.get_default_input_device_info()['index'])  # Use the default input device
        except Exception as e:
            self.log('Error to open mic stream:', e)

    def start_recording(self):
        if self.wake_word:
            # Make sure to stop the wake word detection before recording
            # otherwise it will loop for the wake word and create conflict
            # on the audio stream
            self.wake_word.stop_listening()

        self.is_recording = True
        # Convert the silence duration to the number of audio frames required to detect the silence
        silence_threshold = int(self.silence_duration * self.rate / self.frames_per_buffer)

        try:
            self.log('Recording...')

            while self.is_recording:
                data = self.mic_stream.read(self.frames_per_buffer, exception_on_overflow=False)
                rms = audioop.rms(data, 2)  # width=2 for format=paInt16

                if rms >= self.rms_threshold:
                    if not self.is_voice_activity_detected:
                        self.is_active_listening_enabled = True
                        self.is_voice_activity_detected = True

                    self.interrupt_leon_speech_callback()

                    self.buffer.extend(data)
                    self.silence_frames_count = 0
                else:
                    if self.is_voice_activity_detected:
                        self.silence_start_time = time.time()
                        self.is_voice_activity_detected = False

                    if self.silence_frames_count < silence_threshold:
                        self.silence_frames_count += 1
                    else:
                        if len(self.buffer) > 0:
                            self.log('Silence detected')

                            audio_data = np.frombuffer(self.buffer, dtype=np.int16)
                            if self.compute_type == 'int8_float32':
                                audio_data = audio_data.astype(np.float32) / 32768.0
                            transcribe_params = {
                                'beam_size': 5,
                                'language': 'en',
                                'task': 'transcribe',
                                'condition_on_previous_text': False,
                                'hotwords': 'talking to Leon'
                            }
                            if self.device == 'cpu':
                                transcribe_params['temperature'] = 0
                            segments, info = self.model.transcribe(audio_data, **transcribe_params)

                            for segment in segments:
                                self.log('[%.2fs -> %.2fs] %s' % (segment.start, segment.end, segment.text))
                                self.complete_text += segment.text

                            self.transcribed_callback(self.complete_text)
                            time.sleep(0.1)
                            # Notify the end of the owner's speech
                            self.end_of_owner_speech_callback(self.complete_text)

                            self.complete_text = ''
                            self.buffer = bytearray()

                        should_stop_active_listening = self.is_active_listening_enabled and time.time() - self.silence_start_time > self.active_listening_duration
                        if should_stop_active_listening:
                            self.is_active_listening_enabled = False
                            self.active_listening_disabled_callback()
                            # Do not add anything after this line because it will be ignored
                            # as it loops for the wake word
                            self.stop_recording()
        except Exception as e:
            self.log('Error:', e)

    def stop_recording(self):
        self.log('Recording stopped')

        if self.wake_word:
            self.wake_word.reset_model_state()
            if self.wake_word.is_enabled:
                # Do not add anything after this line because it will be ignored
                # as it loops for the wake word
                self.wake_word.start_listening()
        else:
            self.is_recording = False
            # self.mic_stream.stop_stream()
            # self.mic_stream.close()
            # self.log('Stream closed, recording stopped')

        # Make sure to wait for the recording thread to join before starting a new recording.
        # Only needed when the wake word detection is enabled
        if (
            self.wake_word and
            self.wake_word.is_enabled and
            self.tcp_server.asr_recording_thread and
            self.tcp_server.asr_recording_thread.is_alive()
        ):
            # The thread is only used when received TCP message from the core,
            # hence it is not used when triggered by the wake word.
            # If we do not "join" it, it'll duplicate the recording loop
            self.log('Join recording thread')
            self.tcp_server.asr_recording_thread.join()

    @staticmethod
    def log(*args, **kwargs):
        print('[ASR]', *args, **kwargs)
