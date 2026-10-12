"""Local, persistent OCR worker. Stdout is reserved for JSON responses."""
import base64
from contextlib import redirect_stdout
import json
import os
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

# RapidOCR imports ONNX Runtime; disable telemetry before either can initialize it.
os.environ['ORT_DISABLE_TELEMETRY'] = '1'

from rapidocr import RapidOCR, ModelType, OCRVersion
import yaml

MODEL_SIZE = ModelType.SMALL
CPU_THREADS = 2


def create_engine(detection_root, recognition_root, orientation_root):
    """Pin the multilingual model and CPU budget instead of library defaults."""
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    # Match the relative paths retained by the SDK resource downloader.
    models = {
        'Det.model_path': detection_root / 'inference.onnx',
        'Rec.model_path': recognition_root / 'inference.onnx',
        'Cls.model_path': orientation_root / 'PP-OCRv1/ch_ppocr_mobile_v2.0_cls_infer.onnx',
    }
    for model in models.values():
        if not model.is_file():
            raise FileNotFoundError(f'Missing managed OCR resource: {model}')
    with (recognition_root / 'inference.yml').open(encoding='utf-8') as config:
        characters = yaml.safe_load(config)['PostProcess']['character_dict']
    if not isinstance(characters, list) or not characters or not all(
        isinstance(character, str) for character in characters
    ):
        raise ValueError('Invalid OCR character dictionary')
    # Official exports keep the alphabet in YAML. RapidOCR reads its text form once
    # at initialization; a private temporary file avoids modifying shared resources.
    with TemporaryDirectory(prefix='leon-ocr-') as directory:
        dictionary = Path(directory) / 'characters.txt'
        dictionary.write_text('\n'.join(characters) + '\n', encoding='utf-8')
        return RapidOCR(params={
            **{key: str(value) for key, value in models.items()},
            'Rec.rec_keys_path': str(dictionary),
            'Det.model_type': MODEL_SIZE, 'Rec.model_type': MODEL_SIZE,
            'Det.ocr_version': OCRVersion.PPOCRV6, 'Rec.ocr_version': OCRVersion.PPOCRV6,
            'EngineConfig.onnxruntime.intra_op_num_threads': CPU_THREADS,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
            'Global.log_level': 'warning',
        })


def main():
    """Initialize lazily, then reuse model sessions until the tool closes stdin."""
    engine = None
    for line in sys.stdin:
        try:
            request = json.loads(line)
            with redirect_stdout(sys.stderr):
                if engine is None:
                    engine = create_engine(*(Path(root) for root in sys.argv[1:4]))
                # Empty OCR results may omit the source image; retain its size.
                image = engine.load_img(base64.b64decode(request['image'], validate=True))
                result = engine(image)
            texts = getattr(result, 'txts', None) or ()
            blocks = []
            if texts:
                for text, box, score in zip(texts, result.boxes, result.scores):
                    x, y = float(box[:, 0].min()), float(box[:, 1].min())
                    blocks.append({'kind': 'paragraph', 'text': text,
                        'bbox': {'x': x, 'y': y, 'width': float(box[:, 0].max()) - x,
                                 'height': float(box[:, 1].max()) - y},
                        'polygon': box.tolist(), 'confidence': float(score)})
            # OCR regions are text lines, not inferred headings, tables or charts.
            response = {'text': '\n'.join(texts), 'layout': {
                'width': int(image.shape[1]), 'height': int(image.shape[0]),
                'units': 'pixels', 'blocks': blocks}}
        except Exception as error:
            response = {'error': str(error)}
        print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
