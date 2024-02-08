import readline from 'node:readline'
import fs from 'node:fs'

import axios, {
  type AxiosResponse,
  type ResponseType as AxiosResponseType
} from 'axios'
import prettyBytes from 'pretty-bytes'
import prettyMilliseconds from 'pretty-ms'

export class FileHelper {
  /**
   * Download file
   * @param fileURL The file URL to download
   * @param responseType The Axios request response type
   * @example downloadFile('https://example.com/file.zip', 'arraybuffer') // ArrayBuffer
   */
  public static downloadFile(
    fileURL: string,
    responseType: AxiosResponseType
  ): Promise<AxiosResponse> {
    return axios.get(fileURL, {
      responseType,
      onDownloadProgress: ({ loaded, total, progress, estimated, rate }) => {
        const percentage = Math.floor(Number(progress) * 100)
        const downloadedSize = prettyBytes(loaded)
        const totalSize = prettyBytes(Number(total))
        const estimatedTime = !estimated
          ? 0
          : prettyMilliseconds(estimated * 1_000, { secondsDecimalDigits: 0 })
        const downloadRate = !rate ? 0 : prettyBytes(rate)

        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        process.stdout.write(
          `Download progress: ${percentage}% (${downloadedSize}/${totalSize} | ${downloadRate}/s | ${estimatedTime} ETA)`
        )

        if (percentage === 100) {
          process.stdout.write('\n')
        }
      }
    })
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
}
