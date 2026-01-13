import json
import time
from typing import List, Dict, Any, Optional

from ..base_tool import BaseTool
from ..toolkit_config import ToolkitConfig
from ..network import Network
from .schemas.transcription_schema import TranscriptionOutput, TranscriptionSegment


class AssemblyAIAudioTool(BaseTool):
    TOOLKIT = 'music_audio'

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.network = Network({'base_url': 'https://api.assemblyai.com'})

    @property
    def tool_name(self) -> str:
        return 'assemblyai_audio'

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def transcribe_to_file(
        self,
        input_path: str,
        output_path: str,
        api_key: str,
        speaker_labels: bool = True
    ) -> str:
        """
        Transcribe audio to a file using AssemblyAI's audio transcription API via SDK Network

        Args:
            input_path: Path to the audio file to transcribe
            output_path: Path to save the JSON transcription (unified format)
            api_key: AssemblyAI API key
            speaker_labels: Enable speaker diarization (default: True)

        Returns:
            The path to the transcription file
        """
        if not api_key:
            raise Exception('AssemblyAI API key is missing')

        try:
            # Step 1: Upload the audio file
            with open(input_path, 'rb') as audio_file:
                audio_data = audio_file.read()

            upload_response = self.network.request({
                'url': '/v2/upload',
                'method': 'POST',
                'headers': {
                    'Authorization': api_key,
                    'Content-Type': 'application/octet-stream'
                },
                'data': audio_data
            })

            upload_url = upload_response['data']['upload_url']

            # Step 2: Submit transcription request
            transcription_response = self.network.request({
                'url': '/v2/transcript',
                'method': 'POST',
                'headers': {
                    'Authorization': api_key,
                    'Content-Type': 'application/json'
                },
                'data': {
                    'audio_url': upload_url,
                    'speaker_labels': speaker_labels
                },
                'use_json': True
            })

            transcript_id = transcription_response['data']['id']

            # Step 3: Poll for completion
            max_attempts = 180  # 15 minutes with 5 second intervals
            attempts = 0
            transcript_data = None

            while attempts < max_attempts:
                status_response = self.network.request({
                    'url': f'/v2/transcript/{transcript_id}',
                    'method': 'GET',
                    'headers': {
                        'Authorization': api_key
                    },
                    'use_json': True
                })

                transcript_data = status_response['data']

                if transcript_data['status'] == 'completed':
                    break
                elif transcript_data['status'] == 'error':
                    error_msg = transcript_data.get('error', 'Unknown error')
                    raise Exception(f'AssemblyAI transcription failed: {error_msg}')

                # Wait 5 seconds before polling again
                time.sleep(5)
                attempts += 1

            if attempts >= max_attempts:
                raise Exception('AssemblyAI transcription timed out')

            # Step 4: Parse and save the transcription
            parsed_output = self._parse_transcription(transcript_data)

            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(parsed_output, f, indent=2, ensure_ascii=False)

            return output_path

        except Exception as e:
            raise Exception(f'AssemblyAI transcription failed: {str(e)}')

    def _parse_transcription(
        self,
        raw_output: Dict[str, Any]
    ) -> TranscriptionOutput:
        segments: List[TranscriptionSegment] = []
        speakers_set = set()

        # Use utterances for speaker-labeled segments if available
        utterances = raw_output.get('utterances', [])
        words = raw_output.get('words', [])

        if utterances and len(utterances) > 0:
            for utterance in utterances:
                speaker = utterance.get('speaker')
                segments.append({
                    'from': float(utterance.get('start', 0)) / 1000.0,  # Convert ms to seconds
                    'to': float(utterance.get('end', 0)) / 1000.0,
                    'text': utterance.get('text', ''),
                    'speaker': speaker
                })
                if speaker:
                    speakers_set.add(speaker)
        elif words and len(words) > 0:
            # Fallback to word-level data if utterances are not available
            # Group consecutive words by speaker (if available)
            current_segment = None

            for word in words:
                speaker = word.get('speaker', None)
                word_start = float(word.get('start', 0)) / 1000.0
                word_end = float(word.get('end', 0)) / 1000.0
                word_text = word.get('text', '')

                if (
                    current_segment
                    and current_segment['speaker'] == speaker
                    and word_start - current_segment['to'] < 1.0  # Max 1 second gap
                ):
                    # Extend current segment
                    current_segment['to'] = word_end
                    current_segment['text'] += f' {word_text}'
                else:
                    # Start a new segment
                    if current_segment:
                        segments.append(current_segment)
                    current_segment = {
                        'from': word_start,
                        'to': word_end,
                        'text': word_text,
                        'speaker': speaker
                    }

                if speaker:
                    speakers_set.add(speaker)

            # Push the last segment
            if current_segment:
                segments.append(current_segment)
        else:
            # Fallback: create a single segment with the full text
            audio_duration = raw_output.get('audio_duration', 0)
            segments.append({
                'from': 0.0,
                'to': audio_duration if audio_duration else 0.0,
                'text': raw_output.get('text', ''),
                'speaker': None
            })

        # Calculate duration
        audio_duration = raw_output.get('audio_duration')
        if audio_duration:
            duration = float(audio_duration) / 1000.0
        elif len(segments) > 0:
            duration = segments[-1]['to']
        else:
            duration = 0.0

        return {
            'duration': duration,
            'speakers': list(speakers_set),
            'speaker_count': len(speakers_set),
            'segments': segments,
            'metadata': {
                'tool': self.tool_name
            }
        }
