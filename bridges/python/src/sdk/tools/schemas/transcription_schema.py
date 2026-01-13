from typing import TypedDict, List, Union


class TranscriptionSegment(TypedDict):
    # Start time in seconds (using from_ since 'from' is a Python keyword)
    from_: float

    # End time in seconds
    to: float

    # Transcribed text for this segment
    text: str

    # Speaker identifier
    speaker: Union[str, None]


class TranscriptionMetadata(TypedDict):
    # Tool that generated the transcription
    tool: str


class TranscriptionOutput(TypedDict):
    # Total audio duration in seconds
    duration: float

    # List of unique speaker identifiers
    speakers: List[str]
    
    # Number of unique speakers
    speaker_count: int

    # Array of transcription segments
    segments: List[TranscriptionSegment]

    # Additional metadata about the transcription
    metadata: TranscriptionMetadata
