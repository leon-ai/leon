from typing import TypedDict, List, Union


TranscriptionSegment = TypedDict(
    "TranscriptionSegment",
    {
        "from": float,
        "to": float,
        "text": str,
        "speaker": Union[str, None],
    },
)


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
