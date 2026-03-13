"""All-encompassing test for the CAMB AI Leon integration.

Tests every API endpoint used by the toolkit tool and core TTS provider
against the real CAMB AI API, using raw HTTP requests (no Leon dependencies).

Usage:
    export CAMB_API_KEY="your-key"
    export CAMB_AUDIO_SAMPLE="path/to/audio.wav"
    python test_camb_ai_leon.py
"""

import io
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import requests

CAMB_API_BASE = "https://client.camb.ai/apis"

API_KEY = os.environ.get("CAMB_API_KEY")
if not API_KEY:
    raise RuntimeError("Set CAMB_API_KEY environment variable to run tests")

AUDIO_SAMPLE = os.environ.get(
    "CAMB_AUDIO_SAMPLE",
    str(Path(__file__).resolve().parent.parent / "yt-dlp/voices/original/sabrina-original-clip.mp3"),
)
if AUDIO_SAMPLE and not os.path.isabs(AUDIO_SAMPLE):
    AUDIO_SAMPLE = str(Path(__file__).resolve().parent / AUDIO_SAMPLE)
if not AUDIO_SAMPLE or not os.path.isfile(AUDIO_SAMPLE):
    raise RuntimeError(
        "Set CAMB_AUDIO_SAMPLE environment variable to a local audio file path"
    )

HEADERS = {"x-api-key": API_KEY, "Content-Type": "application/json"}
HEADERS_KEY_ONLY = {"x-api-key": API_KEY}

MAX_POLL_ATTEMPTS = 120
POLL_INTERVAL = 3


def play(path: str):
    """Play an audio file with afplay (macOS)."""
    if sys.platform == "darwin":
        print(f"  Playing: {path}")
        subprocess.run(["afplay", path], check=False)
    else:
        print(f"  Audio file at: {path} (afplay not available on this platform)")


def poll_task(endpoint: str, task_id: int) -> int:
    """Poll a task endpoint until completion. Returns run_id."""
    for _ in range(MAX_POLL_ATTEMPTS):
        resp = requests.get(
            f"{CAMB_API_BASE}/{endpoint}/{task_id}",
            headers=HEADERS,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status", "").upper()
        if status in ("SUCCESS", "COMPLETED"):
            run_id = data.get("run_id")
            if run_id is None:
                raise RuntimeError(f"Task completed but no run_id: {data}")
            return run_id
        if status in ("FAILED", "ERROR"):
            raise RuntimeError(f"Task failed: {data.get('error', data)}")
        time.sleep(POLL_INTERVAL)
    raise RuntimeError(f"Task timed out after {MAX_POLL_ATTEMPTS * POLL_INTERVAL}s")


# ---------------------------------------------------------------------------
# 1. List Voices  (GET /list-voices)
# ---------------------------------------------------------------------------
def test_list_voices():
    """1. Voice List: list available voices via /list-voices."""
    resp = requests.get(
        f"{CAMB_API_BASE}/list-voices",
        headers=HEADERS,
        timeout=30,
    )
    resp.raise_for_status()
    voices = resp.json()
    assert isinstance(voices, list), f"Expected list, got {type(voices)}"
    assert len(voices) > 0, "No voices returned"
    print(f"  Got {len(voices)} voices")
    first = voices[0]
    print(f"  First voice: id={first.get('id')}, name={first.get('voice_name')}")


# ---------------------------------------------------------------------------
# 2. TTS Streaming  (POST /tts-stream)
# ---------------------------------------------------------------------------
def test_tts():
    """2. Text-to-Speech: stream audio via /tts-stream."""
    resp = requests.post(
        f"{CAMB_API_BASE}/tts-stream",
        headers=HEADERS,
        json={
            "text": "Hello from CAMB AI and the Leon integration! This is a text to speech test.",
            "voice_id": 147320,
            "language": "en-us",
            "speech_model": "mars-flash",
            "output_configuration": {"format": "wav"},
        },
        stream=True,
        timeout=120,
    )
    resp.raise_for_status()
    chunks = []
    for chunk in resp.iter_content(chunk_size=4096):
        if chunk:
            chunks.append(chunk)
    audio_data = b"".join(chunks)
    assert len(audio_data) > 0, "No audio data received"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_data)
        path = f.name
    print(f"  Audio saved to: {path} ({len(audio_data)} bytes)")
    play(path)


# ---------------------------------------------------------------------------
# 3. Translation  (POST /translate, GET /translation-result/{run_id})
# ---------------------------------------------------------------------------
def test_translation():
    """3. Translation: translate text via /translate."""
    resp = requests.post(
        f"{CAMB_API_BASE}/translate",
        headers=HEADERS,
        json={
            "texts": ["Hello, how are you?"],
            "source_language": 1,
            "target_language": 2,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id")
    assert task_id is not None, f"No task_id: {data}"
    print(f"  task_id: {task_id}")

    run_id = poll_task("translate", task_id)
    print(f"  run_id: {run_id}")

    result_resp = requests.get(
        f"{CAMB_API_BASE}/translation-result/{run_id}",
        headers=HEADERS,
        timeout=30,
    )
    result_resp.raise_for_status()
    result = result_resp.json()
    print(f"  Result: {result}")


# ---------------------------------------------------------------------------
# 4. Transcription  (POST /transcribe, GET /transcription-result/{run_id})
# ---------------------------------------------------------------------------
def test_transcription():
    """4. Transcription: transcribe audio via /transcribe."""
    filename = os.path.basename(AUDIO_SAMPLE)
    with open(AUDIO_SAMPLE, "rb") as f:
        resp = requests.post(
            f"{CAMB_API_BASE}/transcribe",
            headers=HEADERS_KEY_ONLY,
            files={"media_file": (filename, f, "audio/mpeg")},
            data={"language": 1},
            timeout=60,
        )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id")
    assert task_id is not None, f"No task_id: {data}"
    print(f"  task_id: {task_id}")

    run_id = poll_task("transcribe", task_id)
    print(f"  run_id: {run_id}")

    result_resp = requests.get(
        f"{CAMB_API_BASE}/transcription-result/{run_id}",
        headers=HEADERS,
        timeout=30,
    )
    result_resp.raise_for_status()
    result = result_resp.json()
    text = result.get("transcript") or result.get("text") or str(result)
    print(f"  Transcription: {str(text)[:300]}")


# ---------------------------------------------------------------------------
# 5. Translated TTS  (POST /translated-tts, poll, GET /tts-result/{run_id})
# ---------------------------------------------------------------------------
def test_translated_tts():
    """5. Translated TTS: translate + speak via /translated-tts."""
    resp = requests.post(
        f"{CAMB_API_BASE}/translated-tts",
        headers=HEADERS,
        json={
            "text": "Hello, how are you?",
            "source_language": 1,
            "target_language": 2,
            "voice_id": 147320,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id")
    assert task_id is not None, f"No task_id: {data}"
    print(f"  task_id: {task_id}")

    run_id = poll_task("translated-tts", task_id)
    print(f"  run_id: {run_id}")

    audio_resp = requests.get(
        f"{CAMB_API_BASE}/tts-result/{run_id}",
        headers=HEADERS_KEY_ONLY,
        timeout=120,
    )
    audio_resp.raise_for_status()
    audio_data = audio_resp.content
    assert len(audio_data) > 0, "No audio data"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_data)
        path = f.name
    print(f"  Audio saved to: {path} ({len(audio_data)} bytes)")
    play(path)


# ---------------------------------------------------------------------------
# 6. Text-to-Sound  (POST /text-to-sound, GET /text-to-sound-result/{run_id})
# ---------------------------------------------------------------------------
def test_text_to_sound():
    """6. Text-to-Sound: generate audio from description via /text-to-sound."""
    resp = requests.post(
        f"{CAMB_API_BASE}/text-to-sound",
        headers=HEADERS,
        json={"prompt": "gentle rain on a rooftop"},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id")
    assert task_id is not None, f"No task_id: {data}"
    print(f"  task_id: {task_id}")

    run_id = poll_task("text-to-sound", task_id)
    print(f"  run_id: {run_id}")

    audio_resp = requests.get(
        f"{CAMB_API_BASE}/text-to-sound-result/{run_id}",
        headers=HEADERS_KEY_ONLY,
        timeout=120,
    )
    audio_resp.raise_for_status()
    audio_data = audio_resp.content
    assert len(audio_data) > 0, "No audio data"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_data)
        path = f.name
    print(f"  Audio saved to: {path} ({len(audio_data)} bytes)")
    play(path)


# ---------------------------------------------------------------------------
# 7. Voice Clone  (POST /create-custom-voice)
# ---------------------------------------------------------------------------
def test_voice_clone():
    """7. Voice Clone: clone a voice via /create-custom-voice."""
    filename = os.path.basename(AUDIO_SAMPLE)
    with open(AUDIO_SAMPLE, "rb") as f:
        audio_data = f.read()

    resp = requests.post(
        f"{CAMB_API_BASE}/create-custom-voice",
        headers=HEADERS_KEY_ONLY,
        files={"file": (filename, io.BytesIO(audio_data), "audio/mpeg")},
        data={"voice_name": "leon_test_voice", "gender": 2},
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    voice_id = data.get("voice_id") or data.get("id")
    print(f"  Cloned voice_id: {voice_id}")
    print(f"  Full response: {data}")
    assert voice_id is not None, f"No voice_id in response: {data}"


# ---------------------------------------------------------------------------
# 8. Audio Separation  (POST /audio-separation, GET /audio-separation-result/{run_id})
# ---------------------------------------------------------------------------
def test_audio_separation():
    """8. Audio Separation: separate vocals from background via /audio-separation."""
    filename = os.path.basename(AUDIO_SAMPLE)
    with open(AUDIO_SAMPLE, "rb") as f:
        audio_data = f.read()

    resp = requests.post(
        f"{CAMB_API_BASE}/audio-separation",
        headers=HEADERS_KEY_ONLY,
        files={"media_file": (filename, io.BytesIO(audio_data), "audio/mpeg")},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    task_id = data.get("task_id")
    assert task_id is not None, f"No task_id: {data}"
    print(f"  task_id: {task_id}")

    run_id = poll_task("audio-separation", task_id)
    print(f"  run_id: {run_id}")

    result_resp = requests.get(
        f"{CAMB_API_BASE}/audio-separation-result/{run_id}",
        headers=HEADERS,
        timeout=30,
    )
    result_resp.raise_for_status()
    result = result_resp.json()
    fg = result.get("foreground_audio_url")
    bg = result.get("background_audio_url")
    print(f"  Foreground: {fg}")
    print(f"  Background: {bg}")


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    tests = [
        test_list_voices,
        test_tts,
        test_translation,
        test_transcription,
        test_translated_tts,
        test_text_to_sound,
        test_voice_clone,
        test_audio_separation,
    ]
    passed = 0
    failed = 0
    for t in tests:
        print(f"\n--- {t.__doc__} ---")
        try:
            t()
            print("  PASSED")
            passed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed += 1

    print(f"\n{'=' * 60}")
    print(f"Results: {passed} passed, {failed} failed, {passed + failed} total")
    print(f"{'=' * 60}")
    sys.exit(1 if failed else 0)
