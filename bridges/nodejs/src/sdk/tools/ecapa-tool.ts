import fs from 'node:fs'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

const MODEL_NAME = 'ecapa-voice_gender_classifier'

export default class ECAPATool extends Tool {
  private static readonly TOOLKIT = 'music_audio'
  private readonly config: ReturnType<typeof ToolkitConfig.load>

  constructor() {
    super()
    // Load configuration from central toolkits directory
    this.config = ToolkitConfig.load(ECAPATool.TOOLKIT, this.toolName)
  }

  get toolName(): string {
    // Use the actual config name for toolkit lookup
    return 'ecapa'
  }

  get toolkit(): string {
    return ECAPATool.TOOLKIT
  }

  get description(): string {
    return this.config['description']
  }

  /**
   * Detect gender from audio file using ECAPA-TDNN voice gender classifier
   * @param inputPath The file path of the audio to be analyzed
   * @param device Device to use for processing (cpu, cuda)
   * @returns A promise that resolves with the detected gender: "male", "female", or "unknown"
   */
  async detectGender(inputPath: string, device = 'cpu'): Promise<string> {
    try {
      // Validate input file exists
      if (!fs.existsSync(inputPath)) {
        throw new Error(`Input file does not exist: ${inputPath}`)
      }

      // Get model path using the generic resource system
      const modelPath = await this.getResourcePath(MODEL_NAME)

      const args = [
        '--function',
        'detect_gender',
        '--input',
        inputPath,
        '--model_path',
        modelPath,
        '--device',
        device
      ]

      const result = await this.executeCommand({
        binaryName: 'ecapa-voice_gender_classifier',
        args,
        options: { sync: true }
      })

      // Parse the output to extract gender
      const gender = this.parseGenderOutput(result)

      return gender
    } catch (error: unknown) {
      throw new Error(
        `Voice gender detection failed: ${(error as Error).message}`
      )
    }
  }

  /**
   * Parse the gender detection output
   */
  private parseGenderOutput(rawOutput: string): string {
    const lines = rawOutput.split('\n')

    // Look for gender result in the output
    for (const line of lines) {
      const lowerLine = line.toLowerCase().trim()

      if (lowerLine.includes('gender:')) {
        // Extract gender from line like "Gender: male"
        const match = lowerLine.match(/gender:\s*(male|female|unknown)/i)
        if (match && match[1]) {
          return match[1].toLowerCase()
        }
      }

      // Also check for direct gender output
      if (lowerLine === 'male' || lowerLine === 'female') {
        return lowerLine
      }
    }

    // If no clear gender found, return unknown
    return 'unknown'
  }
}
