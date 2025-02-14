import os
import time
import numpy as np
from openwakeword.model import Model as WakeWordModel

from ..constants import WAKE_WORD_MODEL_FOLDER_PATH

class WakeWord:
    def __init__(self, asr, model_path, device='cpu', detection_threshold=0.5):
        tic = time.perf_counter()
        self.log('Loading model...')

        self.log(f'Device: {device}')

        self.asr = asr
        self.model_path = model_path
        self.device = device
        self.detection_threshold = detection_threshold
        self.chunk_size = 1280
        self.audio = None
        self.is_listening = False
        self.is_enabled = False

        if not os.path.exists(model_path):
            self.log(f'Wake word model not found at {model_path}')
            return

        # @see https://github.com/dscripka/openWakeWord/blob/main/openwakeword/model.py#L38
        # @see https://github.com/dscripka/openWakeWord/blob/main/openwakeword/utils.py#L38
        self.model = WakeWordModel(
            device=self.device,
            wakeword_models=[self.model_path],
            melspec_model_path=os.path.join(WAKE_WORD_MODEL_FOLDER_PATH, 'melspectrogram.onnx'),
            embedding_model_path=os.path.join(WAKE_WORD_MODEL_FOLDER_PATH, 'embedding.onnx'),
            ncpu=1,
            inference_framework='onnx'
        )

        self.log('Model loaded')
        toc = time.perf_counter()

        self.log(f'Time taken to load model: {toc - tic:0.4f} seconds')

        self.is_enabled = True

    def reset_model_state(self):
        """
        Reset the wake word model's prediction buffer to avoid false triggers
        """
        for mdl in self.model.prediction_buffer.keys():
            self.model.prediction_buffer[mdl] = []

    def start_listening(self):
        if self.is_enabled:
            self.asr.is_recording = False
            self.is_listening = True
            self.audio = None

            self.reset_model_state()

            try:
                self.log('Listening...')

                while self.is_listening:
                    # Get audio
                    # Reuse the shared mic audio stream with ASR
                    self.audio = np.frombuffer(self.asr.mic_stream.read(self.chunk_size), dtype=np.int16)

                    # Feed to openWakeWord model
                    prediction = self.model.predict(self.audio)

                    for mdl in self.model.prediction_buffer.keys():
                        scores = list(self.model.prediction_buffer[mdl])

                        if scores[-1] > self.detection_threshold:
                            self.log(f'Wakeword Detected! ({mdl})')
                            self.stop_listening()
                            self.asr.transcribed_callback('')
                            self.asr.start_recording()
            except Exception as e:
                self.stop_listening()
                self.log('Error:', e)

    def stop_listening(self):
        if self.is_enabled:
            self.is_listening = False
            self.log('Stopped listening')

    @staticmethod
    def log(*args, **kwargs):
        print('[Wake word]', *args, **kwargs)
