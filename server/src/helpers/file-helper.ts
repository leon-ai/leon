import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { downloadFile as ipullDownloadFile } from 'ipull'

interface DownloadFileOptions {
  cliProgress?: boolean
  parallelStreams?: number
  skipExisting?: boolean
}

export class FileHelper {
  /**
   * Download file
   * @param fileURL The file URL to download
   * @param destinationPath The destination path to save the file
   * @param options The download options
   * @example downloadFile('https://example.com/file.zip', 'output/dir/file.zip', { cliProgress: true, parallelStreams: 3 })
   */
  public static async downloadFile(
    fileURL: string,
    destinationPath: string,
    options?: DownloadFileOptions
  ): Promise<void> {
    options = {
      cliProgress: true,
      parallelStreams: 3,
      skipExisting: false,
      ...options
    }

    const directory = path.dirname(destinationPath)
    const fileName = path.basename(destinationPath)
    const downloader = await ipullDownloadFile({
      url: fileURL,
      directory,
      fileName,
      ...options
    })

    return downloader.download()
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

    return import(fileURL, options)
  }
}
