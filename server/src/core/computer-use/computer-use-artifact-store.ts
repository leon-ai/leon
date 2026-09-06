import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import ffmpegStatic from 'ffmpeg-static'

import { getProfilePaths } from '@/core/profile-runtime/profile-paths'
import type { ToolProviderExecutionInput } from '@/core/tool-provider/types'

import {
  COMPUTER_USE_ARTIFACT_DIRECTORY,
  COMPUTER_USE_MODEL_IMAGE_LIMIT,
  COMPUTER_USE_TEXT_PREVIEW_MAX_CHARS,
  IMAGE_EXTENSION_BY_MIME_TYPE
} from './constants'
import { calculateComputerUseModelImageDimensions } from './computer-use-coordinate-mapper'
import { createComputerUseSetOfMarkPlan } from './computer-use-set-of-mark'
import type {
  ComputerUseImageDimensions,
  CuaToolResult,
  PersistedComputerUseImages
} from './types'
import { ComputerUseSetOfMarkMode } from './types'

const execFileAsync = promisify(execFile)

/** Persists complete evidence while returning only bounded model attachments. */
export class ComputerUseArtifactStore {
  public async persistCaptureMetadata(
    images: PersistedComputerUseImages,
    observation: Record<string, unknown>
  ): Promise<void> {
    if (!images.transform) return
    const artifact = images.artifacts.at(-1)
    if (typeof artifact?.['path'] !== 'string') return
    // Bind tutorial targets to the exact image, not a later window snapshot.
    await fs.promises.writeFile(`${artifact['path']}.json`, JSON.stringify({
      screenshot_width: images.transform.model.width,
      screenshot_height: images.transform.model.height,
      elements: observation['elements'] || []
    }))
  }

  public getArtifactDirectory(input: ToolProviderExecutionInput): string {
    const sessionDirectory = encodeURIComponent(
      input.conversationSessionId || 'unscoped'
    )
    return path.join(
      getProfilePaths(input.profileName).sessions,
      sessionDirectory,
      'artifacts',
      COMPUTER_USE_ARTIFACT_DIRECTORY
    )
  }

  public async persistStructuredResult(
    input: ToolProviderExecutionInput,
    action: string,
    result: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const artifactDirectory = this.getArtifactDirectory(input)
    await fs.promises.mkdir(artifactDirectory, { recursive: true })
    const artifactPath = path.join(
      artifactDirectory,
      `${Date.now()}-${randomUUID()}-${action}.json`
    )
    const content = `${JSON.stringify(result, null, 2)}\n`
    await fs.promises.writeFile(artifactPath, content, 'utf8')

    return {
      path: artifactPath,
      mime_type: 'application/json',
      size_bytes: Buffer.byteLength(content)
    }
  }

  public async persistImages(
    input: ToolProviderExecutionInput,
    action: string,
    structuredResult: Record<string, unknown> | null,
    result: CuaToolResult,
    setOfMarkMode = ComputerUseSetOfMarkMode.Auto
  ): Promise<PersistedComputerUseImages> {
    if (result.images.length === 0) {
      return {
        artifacts: [],
        modelFiles: [],
        transform: null,
        setOfMark: []
      }
    }

    const artifactDirectory = this.getArtifactDirectory(input)
    await fs.promises.mkdir(artifactDirectory, { recursive: true })
    const sourceDimensions = this.getCaptureDimensions(action, structuredResult)

    const persistedImages = await Promise.all(
      result.images.map(async (image, index) => {
        const extension = IMAGE_EXTENSION_BY_MIME_TYPE[image.mimeType] || 'bin'
        const artifactPath = path.join(
          artifactDirectory,
          `${Date.now()}-${randomUUID()}.${extension}`
        )
        const content = Buffer.from(image.dataBase64, 'base64')
        await fs.promises.writeFile(artifactPath, content)
        const isLatestImage = index === result.images.length - 1
        const modelImage =
          isLatestImage && sourceDimensions
            ? await this.createModelImage(
                artifactPath,
                extension,
                content,
                sourceDimensions,
                action === 'get_window_state' ? structuredResult : null,
                setOfMarkMode
              )
            : {
                dataBase64: image.dataBase64,
                dimensions: sourceDimensions,
                setOfMark: []
              }

        return {
          artifact: {
            path: artifactPath,
            mime_type: image.mimeType,
            size_bytes: content.byteLength
          },
          modelFile: {
            dataBase64: modelImage.dataBase64,
            mediaType: image.mimeType,
            filename: path.basename(artifactPath),
            visualDetail: 'high' as const
          },
          modelDimensions: modelImage.dimensions,
          setOfMark: modelImage.setOfMark
        }
      })
    )
    const latestImage = persistedImages.at(-1)
    const transform =
      sourceDimensions && latestImage?.modelDimensions
        ? { source: sourceDimensions, model: latestImage.modelDimensions }
        : null

    return {
      artifacts: persistedImages.map(({ artifact }) => artifact),
      modelFiles: persistedImages
        .slice(-COMPUTER_USE_MODEL_IMAGE_LIMIT)
        .map(({ modelFile }) => modelFile),
      transform,
      setOfMark: latestImage?.setOfMark || []
    }
  }

  public buildTextPreview(value: string): string {
    if (value.length <= COMPUTER_USE_TEXT_PREVIEW_MAX_CHARS) {
      return value
    }

    return `${value.slice(0, COMPUTER_USE_TEXT_PREVIEW_MAX_CHARS)}\n...[truncated]`
  }

  private getCaptureDimensions(
    action: string,
    result: Record<string, unknown> | null
  ): ComputerUseImageDimensions | null {
    if (action !== 'get_window_state' && action !== 'get_desktop_state') {
      return null
    }

    const width = result?.['screenshot_width']
    const height = result?.['screenshot_height']
    return typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0
      ? { width, height }
      : null
  }

  private async createModelImage(
    artifactPath: string,
    extension: string,
    originalContent: Buffer,
    sourceDimensions: ComputerUseImageDimensions,
    structuredResult: Record<string, unknown> | null,
    setOfMarkMode: ComputerUseSetOfMarkMode
  ): Promise<{
    dataBase64: string
    dimensions: ComputerUseImageDimensions
    setOfMark: PersistedComputerUseImages['setOfMark']
  }> {
    const modelDimensions = calculateComputerUseModelImageDimensions(
      sourceDimensions
    )
    const setOfMark = createComputerUseSetOfMarkPlan(
      structuredResult,
      setOfMarkMode,
      modelDimensions
    )
    const needsResize =
      modelDimensions.width !== sourceDimensions.width ||
      modelDimensions.height !== sourceDimensions.height
    if (
      !ffmpegStatic ||
      extension === 'bin' ||
      (!needsResize && !setOfMark.filter)
    ) {
      return {
        dataBase64: originalContent.toString('base64'),
        dimensions: sourceDimensions,
        setOfMark: []
      }
    }

    const modelImagePath = `${artifactPath}.model.${extension}`
    try {
      const filters = [
        ...(needsResize
          ? [`scale=${modelDimensions.width}:${modelDimensions.height}:flags=lanczos`]
          : []),
        ...(setOfMark.filter ? [setOfMark.filter] : [])
      ].join(',')
      await execFileAsync(ffmpegStatic, [
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        artifactPath,
        '-vf',
        filters,
        '-frames:v',
        '1',
        '-y',
        modelImagePath
      ])
      const resizedContent = await fs.promises.readFile(modelImagePath)
      return {
        dataBase64: resizedContent.toString('base64'),
        dimensions: modelDimensions,
        setOfMark: setOfMark.annotations
      }
    } catch {
      return {
        dataBase64: originalContent.toString('base64'),
        dimensions: sourceDimensions,
        setOfMark: []
      }
    } finally {
      await fs.promises.rm(modelImagePath, { force: true })
    }
  }
}
