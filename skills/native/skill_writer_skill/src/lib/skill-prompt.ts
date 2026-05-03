export type SkillPromptMode = 'create' | 'modify'

export const getContextFiles = (bridge: 'nodejs' | 'python'): string[] =>
  bridge === 'nodejs'
    ? [
        'skills/native/age_skill/skill.json',
        'skills/native/age_skill/src/actions/run.ts',
        'schemas/skill-schemas/skill.json'
      ]
    : [
        'skills/native/guess_the_number_skill/skill.json',
        'skills/native/guess_the_number_skill/src/actions/set_up.py',
        'schemas/skill-schemas/skill.json'
      ]

const baseGuidance = [
  '- First check if any existing Leon tools can help with this functionality',
  '- For video/audio tasks: Use ytdlp-tool, ffmpeg-tool, or other video_streaming tools',
  '- For web requests: Use appropriate HTTP/API tools',
  '- For file operations: Use file system tools',
  '- For audio processing: Use music_audio toolkit tools',
  '- NEVER create new tool functionality that already exists',
  '- Only implement the skill-specific business logic in actions'
]

const createGuidance = [
  '- Choose a concise skill folder name in snake_case ending with _skill under skills/native'
]

const modifyGuidance = [
  '- The skill already exists; do NOT create a new skill folder unless explicitly asked',
  '- Update existing actions or add new action files within the existing skill as needed',
  '- Update the skill.json actions list and locale messages when you add or rename actions'
]

export const buildSkillPrompt = (
  description: string,
  mode: SkillPromptMode
): string => {
  const guidance =
    mode === 'create'
      ? [...baseGuidance, ...createGuidance]
      : [...baseGuidance, ...modifyGuidance]

  return `${description}

IMPORTANT GUIDANCE:
${guidance.join('\n')}`
}
