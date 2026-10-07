import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { Tool } from '@sdk/base-tool'
import { ToolkitConfig } from '@sdk/toolkit-config'

import { ChartFormat, ChartTheme, renderChart } from './lib/render-chart'

const DEFAULT_SETTINGS = {
  width: 960,
  height: 540,
  pixel_ratio: 2,
  font_family: 'Arial, Helvetica, DejaVu Sans, Liberation Sans, sans-serif'
}
const MAX_CHARTS = 12
const MIN_DIMENSION = 128
const MAX_DIMENSION = 2_048
const MAX_PIXEL_RATIO = 2
const MIME_TYPES: Record<ChartFormat, string> = {
  [ChartFormat.Svg]: 'image/svg+xml',
  [ChartFormat.Png]: 'image/png'
}

/**
 * A named data chart expressed through native ECharts JSON options.
 */
export interface ChartDefinition {
  name: string
  option: Record<string, unknown>
}

/**
 * Common artifact formats, appearance and dimensions for a chart batch.
 */
export interface RenderOptions {
  formats?: ChartFormat[]
  theme?: ChartTheme
  width?: number
  height?: number
  pixelRatio?: number
}

/**
 * Produces standalone chart artifacts for downloads and document authoring.
 */
export default class EChartsTool extends Tool {
  private readonly config = ToolkitConfig.load('media_generation', 'echarts')

  constructor() {
    super()

    this.settings = ToolkitConfig.loadToolSettings(
      this.toolkit,
      this.toolName,
      DEFAULT_SETTINGS
    )
    this.checkRequiredSettings(this.toolName)
  }

  get toolName(): string {
    return 'echarts'
  }

  get toolkit(): string {
    return 'media_generation'
  }

  get description(): string {
    return this.config.description
  }

  /**
   * Exports each chart in the requested formats and attaches the completed batch.
   */
  public async render(
    charts: ChartDefinition[],
    options: RenderOptions = {}
  ): Promise<unknown> {
    if (!this.executionContext?.conversationSessionId) {
      throw new Error('Chart generation requires a conversation session.')
    }
    if (charts.length < 1 || charts.length > MAX_CHARTS) {
      throw new Error(`Render between 1 and ${MAX_CHARTS} charts per call.`)
    }

    const formats = [
      ...new Set(options.formats ?? [ChartFormat.Svg, ChartFormat.Png])
    ]
    const theme = options.theme ?? ChartTheme.Light
    const width = options.width ?? this.settings['width']
    const height = options.height ?? this.settings['height']
    const pixelRatio = options.pixelRatio ?? this.settings['pixel_ratio']
    const fontFamily = this.settings['font_family']

    if (
      formats.length === 0 ||
      formats.some((format) => !Object.values(ChartFormat).includes(format))
    ) {
      throw new Error('Select SVG, PNG or both formats.')
    }
    if (!Object.values(ChartTheme).includes(theme)) {
      throw new Error('Use the light or dark chart theme.')
    }
    if (
      typeof width !== 'number' ||
      !Number.isInteger(width) ||
      typeof height !== 'number' ||
      !Number.isInteger(height) ||
      width < MIN_DIMENSION ||
      width > MAX_DIMENSION ||
      height < MIN_DIMENSION ||
      height > MAX_DIMENSION
    ) {
      throw new Error(
        `Chart width and height must be integers from ${MIN_DIMENSION} to ${MAX_DIMENSION}.`
      )
    }
    if (
      typeof pixelRatio !== 'number' ||
      !Number.isInteger(pixelRatio) ||
      pixelRatio < 1 ||
      pixelRatio > MAX_PIXEL_RATIO
    ) {
      throw new Error(`pixelRatio must be an integer from 1 to ${MAX_PIXEL_RATIO}.`)
    }
    if (typeof fontFamily !== 'string' || !fontFamily.trim()) {
      throw new Error('Chart font_family must be a non-empty font family.')
    }

    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-charts-'))

    try {
      const rendered = []

      for (const [index, chart] of charts.entries()) {
        if (!chart.name.trim() || !chart.option || !chart.option['series']) {
          throw new Error('Every chart needs a name and ECharts options containing series.')
        }

        for (const format of formats) {
          const filename = `chart-${index + 1}.${format}`
          const outputPath = path.join(temporary, filename)

          try {
            const bytes = await renderChart({
              option: chart.option,
              format,
              theme,
              width,
              height,
              pixelRatio,
              fontFamily
            })

            await fs.writeFile(outputPath, bytes)
          } catch (error) {
            throw new Error(
              `Could not render chart ${chart.name}: ${(error as Error).message}`
            )
          }

          rendered.push({ name: chart.name, format, filename, outputPath })
        }
      }

      // Publish only after every requested chart rendered successfully. A bad
      // specification must not produce an apparently complete partial batch.
      const artifacts = []
      const outputs = []

      for (const output of rendered) {
        const artifact = await this.createArtifact(
          output.outputPath,
          MIME_TYPES[output.format],
          output.filename
        )

        artifacts.push(artifact)
        outputs.push({
          name: output.name,
          format: output.format,
          path: artifact.path,
          filename: artifact.filename,
          width: output.format === ChartFormat.Png ? width * pixelRatio : width,
          height: output.format === ChartFormat.Png ? height * pixelRatio : height
        })
      }

      return { charts: outputs, artifacts }
    } finally {
      await fs.rm(temporary, { recursive: true, force: true })
    }
  }
}
