import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { execFileSync } from 'node:child_process'

import {
  NetworkHelper,
  type DownloadFileOptions
} from '@/helpers/network-helper'
import { SystemHelper } from '@/helpers/system-helper'

const DEFAULT_FILE_ICON_NAME = 'file-line'
const FOLDER_ICON_NAME = 'folder-3-line'
const ZIP_ARCHIVE_EXTENSIONS = new Set(['.zip', '.whl'])
const IMAGE_FILE_EXTENSIONS = [
  '.avif',
  '.bmp',
  '.gif',
  '.heic',
  '.heif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp'
]
const VIDEO_FILE_EXTENSIONS = [
  '.avi',
  '.flv',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.webm',
  '.wmv'
]
const AUDIO_FILE_EXTENSIONS = [
  '.aac',
  '.aiff',
  '.alac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.wma'
]
const CODE_FILE_EXTENSIONS = [
  '.c',
  '.cc',
  '.clj',
  '.cpp',
  '.cs',
  '.css',
  '.dart',
  '.ex',
  '.exs',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.lua',
  '.mjs',
  '.php',
  '.pl',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.sass',
  '.scss',
  '.sh',
  '.sql',
  '.swift',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
  '.zig'
]
const TEXT_FILE_EXTENSIONS = ['.csv', '.log', '.rtf', '.txt']
const ARCHIVE_FILE_EXTENSIONS = [
  '.7z',
  '.bz2',
  '.gz',
  '.rar',
  '.tar',
  '.tgz',
  '.xz',
  '.zip'
]
function mapExtensionsToIcon(
  extensions: string[],
  iconName: string
): Array<[string, string]> {
  return extensions.map((extension) => [extension, iconName])
}

const FILE_EXTENSION_REMIX_ICON_NAMES = new Map<string, string>([
  ...mapExtensionsToIcon(IMAGE_FILE_EXTENSIONS, 'file-image-line'),
  ...mapExtensionsToIcon(VIDEO_FILE_EXTENSIONS, 'file-video-line'),
  ...mapExtensionsToIcon(AUDIO_FILE_EXTENSIONS, 'file-music-line'),
  ...mapExtensionsToIcon(CODE_FILE_EXTENSIONS, 'file-code-line'),
  ...mapExtensionsToIcon(TEXT_FILE_EXTENSIONS, 'file-text-line'),
  ...mapExtensionsToIcon(ARCHIVE_FILE_EXTENSIONS, 'file-zip-line'),
  ['.doc', 'file-word-line'],
  ['.docx', 'file-word-line'],
  ['.md', 'markdown-line'],
  ['.mdx', 'markdown-line'],
  ['.odp', 'file-ppt-line'],
  ['.ods', 'file-excel-line'],
  ['.odt', 'file-word-line'],
  ['.pdf', 'file-pdf-2-line'],
  ['.ppt', 'file-ppt-line'],
  ['.pptx', 'file-ppt-line'],
  ['.xls', 'file-excel-line'],
  ['.xlsx', 'file-excel-line']
])

export class FileHelper {
  public static readonly DEFAULT_FILE_REMIX_ICON_NAME = DEFAULT_FILE_ICON_NAME

  public static readonly FOLDER_REMIX_ICON_NAME = FOLDER_ICON_NAME

  /**
   * Check whether a path exists on disk.
   * @param filePath The path to inspect
   * @returns Whether the path currently exists
   */
  public static isExistingPath(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  /**
   * Resolve the Remix icon name for a file path based on its extension.
   * @param filePath The file path or file name to inspect
   * @returns The Remix icon name with its "-line" suffix
   */
  public static getRemixIconName(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase()

    return (
      FILE_EXTENSION_REMIX_ICON_NAMES.get(extension) ||
      DEFAULT_FILE_ICON_NAME
    )
  }

  /**
   * Compatibility wrapper around the network helper so current callers do not
   * need to change while download logic stays centralized.
   * @param fileURL The remote URL or local file path to download from
   * @param destinationPath The destination file path
   * @param options Download behavior options
   */
  public static async downloadFile(
    fileURL: string,
    destinationPath: string,
    options?: DownloadFileOptions
  ): Promise<void> {
    await NetworkHelper.downloadFile(fileURL, destinationPath, options)
  }

  /**
   * Create a manifest file
   * @param manifestPath The manifest file path
   * @param manifestName The manifest name
   * @param manifestVersion The manifest version
   * @param extraData Extra data to add to the manifest
   */
  public static async createManifestFile(
    manifestPath: string,
    manifestName: string,
    manifestVersion: string,
    extraData?: Record<string, unknown>
  ): Promise<void> {
    const manifest = {
      name: manifestName,
      version: manifestVersion,
      setupDate: Date.now(),
      ...extraData
    }

    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  }

  /**
   * Extract archive file using native system commands
   * Supports .zip, .tar, .tar.gz, .tar.xz, .tgz formats across all platforms
   * @param archivePath The path to the archive file
   * @param targetPath The path to extract to
   * @param options Extraction options
   * @example extractArchive('archive.zip', 'output/dir')
   * @example extractArchive('archive.tar.xz', 'output/dir', { stripComponents: 1 })
   */
  public static async extractArchive(
    archivePath: string,
    targetPath: string,
    options?: {
      stripComponents?: number
    }
  ): Promise<void> {
    const stripComponents = options?.stripComponents ?? 0

    await fs.promises.mkdir(targetPath, { recursive: true })

    const ext = path.extname(archivePath).toLowerCase()
    const basename = path.basename(archivePath).toLowerCase()

    try {
      if (ZIP_ARCHIVE_EXTENSIONS.has(ext)) {
        if (SystemHelper.isWindows()) {
          execFileSync('tar', ['-xf', archivePath, '-C', targetPath], {
            stdio: 'inherit',
            windowsHide: true
          })
        } else {
          execFileSync('unzip', ['-o', '-q', archivePath, '-d', targetPath], {
            stdio: 'inherit',
            windowsHide: true
          })
        }
      } else if (
        basename.endsWith('.tar.gz') ||
        basename.endsWith('.tar.xz') ||
        basename.endsWith('.tgz') ||
        ext === '.tar'
      ) {
        const tarArgs = ['-xf', archivePath, '-C', targetPath]

        if (stripComponents > 0) {
          tarArgs.push(`--strip-components=${stripComponents}`)
        }

        execFileSync('tar', tarArgs, {
          stdio: 'inherit',
          windowsHide: true
        })
      } else {
        throw new Error(`Unsupported archive format: ${archivePath}`)
      }
    } catch (error) {
      throw new Error(
        `Failed to extract archive "${archivePath}": ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * Dynamically imports a module or JSON file using a file path,
   * ensuring cross-platform compatibility for native ESM imports
   * @param filePath
   * @param options
   * @example dynamicImportFromFile('path/to/module.js')
   */
  public static async dynamicImportFromFile(
    filePath: string,
    options?: ImportCallOptions
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const absolutePath = path.resolve(filePath)
    const fileURL = url.pathToFileURL(absolutePath).href

    const importer = new Function(
      'url',
      'options',
      'return import(url, options)'
    )

    return importer(fileURL, options)
  }
}
