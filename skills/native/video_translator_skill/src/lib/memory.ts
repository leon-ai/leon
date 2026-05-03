import { Memory } from '@sdk/memory'

export interface VideoTranslatorMemory {
  videoPath: string
  targetLanguage: string
  quality?: string
  audioPath?: string
  audioFormat?: string
  transcriptionPath?: string
  modelSize?: string
  createdAt: number
}

const VIDEO_TRANSLATOR_MEMORY = new Memory<VideoTranslatorMemory | null>({
  name: 'video_translator',
  defaultMemory: null
})

export async function saveVideoInfo(
  videoPath: string,
  targetLanguage: string,
  quality?: string
): Promise<VideoTranslatorMemory> {
  const videoInfo: VideoTranslatorMemory = {
    videoPath,
    targetLanguage,
    createdAt: Date.now(),
    ...(quality && { quality })
  }

  await VIDEO_TRANSLATOR_MEMORY.write(videoInfo)

  return videoInfo
}

export async function getVideoInfo(): Promise<VideoTranslatorMemory | null> {
  return await VIDEO_TRANSLATOR_MEMORY.read()
}

export async function updateAudioInfo(
  audioPath: string,
  audioFormat: string
): Promise<VideoTranslatorMemory | null> {
  const currentMemory = await VIDEO_TRANSLATOR_MEMORY.read()

  if (!currentMemory) {
    return null
  }

  const updatedMemory: VideoTranslatorMemory = {
    ...currentMemory,
    audioPath,
    audioFormat
  }

  await VIDEO_TRANSLATOR_MEMORY.write(updatedMemory)

  return updatedMemory
}

export async function updateTranscriptionInfo(
  transcriptionPath: string
): Promise<VideoTranslatorMemory | null> {
  const currentMemory = await VIDEO_TRANSLATOR_MEMORY.read()

  if (!currentMemory) {
    return null
  }

  const updatedMemory: VideoTranslatorMemory = {
    ...currentMemory,
    transcriptionPath
  }

  await VIDEO_TRANSLATOR_MEMORY.write(updatedMemory)

  return updatedMemory
}

export async function clearVideoInfo(): Promise<void> {
  await VIDEO_TRANSLATOR_MEMORY.clear()
}
