export interface TranscriptionSegment {
  // Start time in seconds
  from: number

  // End time in seconds
  to: number

  // Transcribed text for this segment
  text: string

  // Speaker identifier
  speaker: string | null
}

export interface TranscriptionOutput {
  // Total audio duration in seconds
  duration: number

  // List of unique speaker identifiers
  speakers: string[]

  // Number of unique speakers
  speaker_count: number

  // Additional metadata about the transcription
  metadata: {
    // Tool that generated the transcription
    tool: string
  }

  // Array of transcription segments
  segments: TranscriptionSegment[]
}
