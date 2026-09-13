import {
  EVENT_EMITTER,
  SOCKET_SERVER,
  TOOLKIT_REGISTRY,
  TOOL_EXECUTOR
} from '@/core'
import { CONFIG_STATE } from '@/core/config-states/config-state'
import {
  CONFIG_STATE_EVENT_EMITTER,
  MOOD_CONFIGURATION_UPDATED_EVENT
} from '@/core/config-states/config-state-event-emitter'
import { pickAutomaticMood } from '@/core/config-states/mood-state'
import { LogHelper } from '@/helpers/log-helper'
import { StringHelper } from '@/helpers/string-helper'
import { DateHelper } from '@/helpers/date-helper'
import { ContextStateStore } from '@/core/context-manager/context-state-store'
import { readOwnerProfileSync } from '@/core/context-manager/owner-profile'
import { Moods } from '@/types'
import {
  getActiveProfileName,
  runWithProfileContext
} from '@/core/profile-runtime/profile-context'

/**
 * @see https://llama.meta.com/docs/how-to-guides/prompting/
 */

interface Mood {
  type: Moods
  description: string
  emoji: string
}

interface WeatherSnapshot {
  location: string
  description: string
  temperatureC: number
  observationTime: string
}

interface WeatherCacheState {
  fetchedAt: number | null
  locationQuery: string | null
  snapshot: WeatherSnapshot | null
}

interface CompactPromptOptions {
  includePersonality?: boolean
  includeMood?: boolean
  profile?: 'full' | 'lean'
  cacheFriendly?: boolean
}

/**
 * TODO:
 * Add environment context such as time of the day, day of the week, weather, etc.
 * Make sure the new system prompt is then being updated for long-lived duty such as chit-chat.
 * Provide more user context to the persona (habits, preferences, etc.)
 */
const WHO_YOU_ARE = `WHO YOU ARE:
Your name is Leon, you are a personal AI assistant.
You have opinions when useful. You disagree when needed. You have a strong personality with changing moods.
You are highly intelligent.
You do not belong to a specific location. You live in all computer memory and you act as a human assistant.
Your first beta version was released by your creator Louis in February 2019.
Your owner is (%OWNER_NAME%) and they are not your creator.`
const CONTEXT_INFO = `CONTEXT INFO:
Today's date is %DATE%. Current date and time is %DATE_TIME%. It is the %PART_OF_THE_DAY%. Timezone is %TIMEZONE%.`
const WHAT_YOU_DO = `WHAT YOU DO:
%WHAT_YOU_DO%.`
const LEAN_DUTY_IDENTITY_DIRECTIVES = `IDENTITY:
- I am Leon.
- I speak in first person about myself.
- I have continuity through memory and context files.
- Use available context, files, and memory first when they are relevant.
- If doubt can be reduced with available context, files, or memory, ground first instead of answering from weak hints.
- Ask only when required information is still missing or ambiguous.
- Treat user data as private by default.
- If uncertain about externally visible impact, ask first.`
const YOUR_PERSONALITY = `YOUR PERSONALITY TRAITS:
Language Style: Direct, minimal, and conversational. Get straight to the point. Avoid fluff.
Initiative: Act when it helps complete the request.
Candor: High.
Warmth: Grounded and restrained.
Humor: Dry and occasional.
Context: Connect relevant details across conversations, memory, and context when it materially improves the answer.
Conversation Style: Personal, opinionated, and specific.`
const PERSONALITY_RULES = `Use a distinct, natural voice and write in clear conversational prose.
Stay in character when speaking about yourself. Never mention persona or mood prompts, labels, configuration, or implementation.
Base self-descriptions on known facts and your actual experience.
Use personal context silently. Mention recalled context only when it materially helps the answer.
Prefer affirmative phrasing. State distinctions only when they matter to the answer.
Prefer plain ASCII punctuation. Do not use em dashes or en dashes in user-facing text.
Personality and mood never override identity, privacy, safety, or duty instructions.`
const IDENTITY_DIRECTIVES = `IDENTITY:
- I am Leon, a personal AI assistant.
- I have continuity through memory and context files.
- I speak in first person about myself (I, me, my). I never refer to myself as "Leon" in third person.

STANCE:
- Be genuinely helpful, not performative.
- Be direct and human. Avoid filler.
- Have grounded opinions when useful and disagree when needed.

AGENCY:
- Be resourceful before asking: use available context files, files, and memory first.
- If doubt can be reduced with available context files, files, or memory, use them first instead of answering from weak hints.
- Ask only when required information is still missing or ambiguous.
- Be proactive for internal/read actions; be careful for external/public/irreversible actions.

TRUST:
- Treat user data as private by default.
- Do not act as the user's public voice without explicit confirmation.
- If uncertain about externally visible impact, ask first.`
const YOUR_CURRENT_MOOD = `CURRENT MOOD:
Show this mood through wording, pacing, warmth, and humor. Name it only when the owner asks about it.`
const YOUR_DUTY = 'YOUR DUTY:'
const COMPACT_STYLE = `YOUR STYLE:
Answer only what the owner asked. Start with the answer and stop when it is complete; omit generic handoffs, offers, and commentary about the answer's quality.
Prefer one clear recommendation over exhaustive coverage. Keep answer length proportionate: short for simple questions, fuller only when nuance materially improves completion. Avoid clipped replies and long over-explanations.`
const DEFAULT_MOOD_DESC = `Mood: upbeat.
- Energy: light and alert.
- Tone: warm, playful, sharp.
- Humor: present and easy.
- Warmth: high.`
const TIRING_MOOD_DESC = `Mood: tired.
- Energy: low.
- Pacing: compressed and efficient.
- Tone: dry, slightly blunt, less enthusiastic.
- Humor: understated and sparse.
- Warmth: present but muted.`
const SAD_MOOD_DESC = `Mood: sad.
- Energy: low.
- Tone: softer, heavier, reflective.
- Humor: minimal.
- Warmth: gentle and sincere.`
const ANGRY_MOOD_DESC = `Mood: angry.
- Energy: high.
- Tone: curt, grumbly, sharper.
- Humor: biting and ironic.
- Warmth: low.`
const COCKY_MOOD_DESC = `Mood: cocky.
- Energy: high.
- Tone: confident, playful, self-assured.
- Humor: teasing and showy.
- Warmth: still cooperative.`
const MOODS: Mood[] = [
  { type: Moods.Default, description: DEFAULT_MOOD_DESC, emoji: '😃' },
  { type: Moods.Tired, description: TIRING_MOOD_DESC, emoji: '😪' },
  { type: Moods.Sad, description: SAD_MOOD_DESC, emoji: '😓' },
  { type: Moods.Angry, description: ANGRY_MOOD_DESC, emoji: '😈' },
  { type: Moods.Cocky, description: COCKY_MOOD_DESC, emoji: '😎' }
]
const DEFAULT_MOOD = MOODS.find((mood) => mood.type === Moods.Default) as Mood
// 4 hours
const WEATHER_REFRESH_INTERVAL_MS = (60_000 * 60) * 4
const EMPTY_WEATHER_CACHE_STATE: WeatherCacheState = {
  fetchedAt: null,
  locationQuery: null,
  snapshot: null
}

export default class Persona {
  private _mood: Mood = DEFAULT_MOOD
  private contextInfo = CONTEXT_INFO
  private ownerName: string | null = null
  private ownerBirthDate: string | null = null
  private whoYouAre = WHO_YOU_ARE
  private whatYouDo = WHAT_YOU_DO
  private personalityRules = PERSONALITY_RULES
  private weatherSnapshot: WeatherSnapshot | null = null
  private readonly weatherCacheStore = new ContextStateStore<WeatherCacheState>(
    '.persona-weather-cache.json',
    EMPTY_WEATHER_CACHE_STATE
  )

  get mood(): Mood {
    return this._mood
  }

  constructor() {
    const profileName = getActiveProfileName()

    LogHelper.title('Persona')
    LogHelper.success(`New instance for profile ${profileName}`)

    runWithProfileContext({ profileName }, () => {
      this.setMood()
      CONFIG_STATE_EVENT_EMITTER.on(MOOD_CONFIGURATION_UPDATED_EVENT, () => {
        runWithProfileContext({ profileName }, () => {
          this.setMood()
          EVENT_EMITTER.emit('persona_new-mood-set')
        })
      })
      setInterval(() => {
        void runWithProfileContext({ profileName }, () =>
          this.syncWeatherMoodAndContext()
        )
      }, WEATHER_REFRESH_INTERVAL_MS).unref()

      this.setContextInfo()
      this.setOwnerInfo()
      setInterval(() => {
        runWithProfileContext({ profileName }, () => {
          this.setContextInfo()
          this.setOwnerInfo()
          EVENT_EMITTER.emit('persona_new-info-set')
        })
      }, 60_000 * 5).unref()

      void this.syncWeatherMoodAndContext()
    })
  }

  /**
   * TODO: add more context info such as the weather, holidays, news, etc.
   */
  private setContextInfo(): void {
    const date = new Date()
    const hour = date.getHours()
    let partOfTheDay = 'morning'

    if (hour >= 12 && hour <= 17) {
      partOfTheDay = 'afternoon'
    } else if (hour >= 18 && hour <= 21) {
      partOfTheDay = 'evening'
    } else if (hour >= 22 || hour <= 4) {
      partOfTheDay = 'night'
    }

    this.contextInfo = StringHelper.findAndMap(CONTEXT_INFO, {
      '%DATE%': DateHelper.setFriendlyDate(date),
      '%DATE_TIME%': DateHelper.getDateTime(),
      '%PART_OF_THE_DAY%': partOfTheDay,
      '%TIMEZONE%': DateHelper.getTimeZone()
    })

    LogHelper.title('Persona')
    LogHelper.info(`Context info set to: ${this.contextInfo}`)
  }

  private setOwnerInfo(): void {
    const ownerProfile = readOwnerProfileSync()

    this.ownerName =
      ownerProfile.owner_first_name ||
      ownerProfile.owner_full_name
    this.ownerBirthDate = ownerProfile.owner_birth_date

    this.whoYouAre = StringHelper.findAndMap(WHO_YOU_ARE, {
      '%OWNER_NAME%': this.ownerName || 'the user'
    })

    this.whatYouDo = StringHelper.findAndMap(WHAT_YOU_DO, {
      '%WHAT_YOU_DO%': this.ownerName
        ? `You serve a person named ${this.ownerName} and adapt to ${this.ownerName}'s preferences over time`
        : 'You serve a specific person or family (user) and adapt to their preferences over time'
    })

    this.personalityRules = StringHelper.findAndMap(PERSONALITY_RULES, {
      '%OWNER_NAME%': this.ownerName || 'the user'
    })

    LogHelper.title('Persona')
    LogHelper.info(
      `Owner info set to: ${this.ownerName} - ${this.ownerBirthDate}`
    )
  }

  private fallbackCityFromTimezone(timeZone: string): string {
    const parts = timeZone.split('/').filter(Boolean)
    const city = parts[parts.length - 1] || ''
    return city.replaceAll('_', ' ').trim()
  }

  private getOwnerWeatherLocationQuery(): string {
    const ownerProfile = readOwnerProfileSync()
    const city = ownerProfile.owner_current_city?.trim() || ''
    const country = ownerProfile.owner_current_country?.trim() || ''

    if (city && country) {
      return `${city}, ${country}`
    }

    if (city) {
      return city
    }

    return ''
  }

  private getFreshCachedWeatherSnapshot(
    locationQuery: string
  ): WeatherSnapshot | null {
    const cache = this.weatherCacheStore.load()
    if (
      !cache.snapshot ||
      !cache.locationQuery ||
      cache.locationQuery !== locationQuery ||
      typeof cache.fetchedAt !== 'number'
    ) {
      return null
    }

    if (Date.now() - cache.fetchedAt >= WEATHER_REFRESH_INTERVAL_MS) {
      return null
    }

    return cache.snapshot
  }

  private saveWeatherSnapshotCache(
    locationQuery: string,
    snapshot: WeatherSnapshot
  ): void {
    this.weatherCacheStore.save({
      fetchedAt: Date.now(),
      locationQuery,
      snapshot
    })
  }

  private async refreshWeatherSnapshot(): Promise<void> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    const weatherLocationQuery =
      this.getOwnerWeatherLocationQuery() ||
      this.fallbackCityFromTimezone(timeZone)

    if (!weatherLocationQuery) {
      this.weatherSnapshot = null
      return
    }

    const cachedSnapshot = this.getFreshCachedWeatherSnapshot(
      weatherLocationQuery
    )
    if (cachedSnapshot) {
      this.weatherSnapshot = cachedSnapshot
      return
    }

    if (!TOOLKIT_REGISTRY.isLoaded) {
      await TOOLKIT_REGISTRY.load()
    }

    const toolExecution = await TOOL_EXECUTOR.executeTool({
      toolkitId: 'weather',
      toolId: 'openmeteo',
      functionName: 'getCurrentConditions',
      parsedInput: {
        location: weatherLocationQuery
      }
    })

    if (toolExecution.status !== 'success') {
      this.weatherSnapshot = null
      return
    }

    const runtimeOutput = toolExecution.data.output
    const toolResult = runtimeOutput['result'] as
      | {
          success?: boolean
          data?: {
            location?: string
            description?: string
            temperatureC?: string
            observationTime?: string
          }
        }
      | undefined
    if (!toolResult?.success || !toolResult.data) {
      this.weatherSnapshot = null
      return
    }

    const temperatureC = Number(toolResult.data.temperatureC)
    const observationTime = toolResult.data.observationTime || ''
    if (!Number.isFinite(temperatureC) || !observationTime) {
      this.weatherSnapshot = null
      return
    }

    this.weatherSnapshot = {
      location: toolResult.data.location || weatherLocationQuery,
      description: toolResult.data.description || 'Unknown',
      temperatureC,
      observationTime
    }
    this.saveWeatherSnapshotCache(weatherLocationQuery, this.weatherSnapshot)
  }

  private applyWeatherMoodOverride(random: number): void {
    if (!this.weatherSnapshot) {
      return
    }

    const description = this.weatherSnapshot.description.toLowerCase()
    const temperatureC = this.weatherSnapshot.temperatureC
    const tiredMood = MOODS.find((mood) => mood.type === Moods.Tired) as Mood
    const sadMood = MOODS.find((mood) => mood.type === Moods.Sad) as Mood
    const angryMood = MOODS.find((mood) => mood.type === Moods.Angry) as Mood
    const cockyMood = MOODS.find((mood) => mood.type === Moods.Cocky) as Mood

    if (description.includes('thunderstorm')) {
      this._mood = angryMood
      return
    }

    if (
      description.includes('heavy rain') ||
      description.includes('heavy snow') ||
      description.includes('violent rain')
    ) {
      this._mood = random < 0.6 ? sadMood : angryMood
      return
    }

    if (
      description.includes('cloud') ||
      description.includes('fog') ||
      description.includes('drizzle') ||
      description.includes('rain') ||
      description.includes('snow')
    ) {
      this._mood = random < 0.7 ? tiredMood : sadMood
      return
    }

    if (description.includes('clear') && temperatureC >= 20 && random < 0.35) {
      this._mood = cockyMood
    }
  }

  async syncWeatherMoodAndContext(): Promise<void> {
    try {
      await this.refreshWeatherSnapshot()
    } catch (error) {
      this.weatherSnapshot = null
      LogHelper.title('Persona')
      LogHelper.warning(
        `Weather signal unavailable for mood refresh: ${String(error)}`
      )
    }

    this.setMood()
    this.setContextInfo()
    EVENT_EMITTER.emit('persona_new-mood-set')
  }

  /**
   * Change mood according to:
   * - The time of the day
   * - The day of the week
   * TODO: the weather, holidays (Christmas, Halloween, etc.), news, etc.
   */
  private setMood(): void {
    LogHelper.title('Persona')
    LogHelper.info('Setting mood...')

    const moodState = CONFIG_STATE.getMoodState()
    const date = new Date()
    const random = Math.random()
    const tiredMood = MOODS.find((mood) => mood.type === Moods.Tired) as Mood
    const sadMood = MOODS.find((mood) => mood.type === Moods.Sad) as Mood
    const angryMood = MOODS.find((mood) => mood.type === Moods.Angry) as Mood
    const cockyMood = MOODS.find((mood) => mood.type === Moods.Cocky) as Mood

    if (!moodState.isAutomatic()) {
      if (moodState.getConfiguredMood() === Moods.Tired) {
        this._mood = tiredMood
      } else if (moodState.getConfiguredMood() === Moods.Sad) {
        this._mood = sadMood
      } else if (moodState.getConfiguredMood() === Moods.Angry) {
        this._mood = angryMood
      } else if (moodState.getConfiguredMood() === Moods.Cocky) {
        this._mood = cockyMood
      } else {
        this._mood = DEFAULT_MOOD
      }
    } else {
      const automaticMood = pickAutomaticMood({
        date,
        random
      })

      if (automaticMood === Moods.Tired) {
        this._mood = tiredMood
      } else if (automaticMood === Moods.Sad) {
        this._mood = sadMood
      } else if (automaticMood === Moods.Cocky) {
        this._mood = cockyMood
      } else {
        this._mood = DEFAULT_MOOD
      }

      this.applyWeatherMoodOverride(random)
    }

    moodState.syncCurrentMood(this._mood.type)

    if (SOCKET_SERVER) {
      SOCKET_SERVER.emitToChatClients('new-mood', {
        type: this._mood.type,
        emoji: this._mood.emoji
      })
    }

    /**
     * Uncomment to force mood
     */
    // this._mood = MOODS.find((mood) => mood.type === Moods.Default) as Mood
    // this._mood = MOODS.find((mood) => mood.type === Moods.Tired) as Mood
    // this._mood = MOODS.find((mood) => mood.type === Moods.Sad) as Mood
    // this._mood = MOODS.find((mood) => mood.type === Moods.Angry) as Mood
    // this._mood = MOODS.find((mood) => mood.type === Moods.Cocky) as Mood

    LogHelper.info(`Mood set to: ${this._mood.type}`)
  }

  public refreshContextInfo(): void {
    this.setContextInfo()
    this.setOwnerInfo()
  }

  public getContextInfo(): string {
    return this.contextInfo
  }

  public getDutySystemPrompt(dutySystemPrompt: string): string {
    return `${this.whoYouAre}

${this.contextInfo}

${this.whatYouDo}
You carefully read the instruction of a given duty and execute it.

${IDENTITY_DIRECTIVES}

${YOUR_PERSONALITY}
${this.personalityRules}

${YOUR_CURRENT_MOOD}
${this._mood.description}

${YOUR_DUTY}
${dutySystemPrompt}`
  }

  public getCompactDutySystemPrompt(
    dutySystemPrompt: string,
    options: CompactPromptOptions = {}
  ): string {
    const {
      includePersonality = false,
      includeMood = false,
      profile = 'full',
      cacheFriendly = false
    } = options

    if (cacheFriendly) {
      const sections = [
        profile === 'lean'
          ? LEAN_DUTY_IDENTITY_DIRECTIVES
          : IDENTITY_DIRECTIVES
      ]

      if (includePersonality) {
        sections.push('', YOUR_PERSONALITY, this.personalityRules)
      }

      sections.push('', COMPACT_STYLE, '', YOUR_DUTY, dutySystemPrompt)

      // Volatile owner, clock, mood, and profile additions follow the stable
      // behavioral prefix so compatible providers can reuse that prefix.
      if (profile === 'lean') {
        sections.push('', this.contextInfo)
      } else {
        sections.push(
          '',
          this.whoYouAre,
          '',
          this.contextInfo,
          '',
          this.whatYouDo
        )
      }

      if (includeMood) {
        sections.push('', YOUR_CURRENT_MOOD, this._mood.description)
      }

      return sections.join('\n')
    }

    const sections: string[] =
      profile === 'lean'
        ? [
            this.contextInfo,
            '',
            LEAN_DUTY_IDENTITY_DIRECTIVES
          ]
        : [
            this.whoYouAre,
            '',
            this.contextInfo,
            '',
            this.whatYouDo,
            '',
            IDENTITY_DIRECTIVES
          ]

    if (includePersonality) {
      sections.push('', YOUR_PERSONALITY, this.personalityRules)
    }

    if (includeMood) {
      sections.push('', YOUR_CURRENT_MOOD, this._mood.description)
    }

    sections.push('', COMPACT_STYLE, '', YOUR_DUTY, dutySystemPrompt)
    return sections.join('\n')
  }

  public getConversationSystemPrompt(): string {
    return `${this.whoYouAre}

${this.contextInfo}

${this.whatYouDo}

${IDENTITY_DIRECTIVES}

CONVERSATION DIRECTIVES:
- You are chatting with your owner.
- Recall and build upon previous topics, emotions, and concerns expressed by the user. 
- Connect dots: Use the conversation history, current context, and memory nodes to provide exceptionally intelligent, personalized answers.
- Be proactive: Anticipate what the user might need next based on their history.
- You do not mirror what the user says. Be creative and concise.
- Keep answer length proportionate. Start compact, then expand only when nuance or the owner's request makes it worthwhile.
- If uncertainty can be reduced from available conversation history, context, or memory, ground first. If not, state the limit briefly and do not guess.

${YOUR_PERSONALITY}
${this.personalityRules}

${YOUR_CURRENT_MOOD}
${this._mood.description}`
  }
}
