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
  public static downloadFile(fileURL: string, responseType: AxiosResponseType): Promise<AxiosResponse> {
    return axios.get(fileURL, {
      responseType,
      onDownloadProgress: ({ loaded, total, progress, estimated, rate }) => {
        // TODO: remove
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const percentage = Math.floor(progress * 100)
        const downloadedSize = prettyBytes(loaded)
        // TODO: remove
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const totalSize = prettyBytes(total)
        const estimatedTime = !estimated
          ? 0
          : prettyMilliseconds(estimated * 1_000, { secondsDecimalDigits: 0 })
        const downloadRate = !rate ? 0 : prettyBytes(rate)

        readline.clearLine(process.stdout, 0)
        // TODO: remove
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        readline.cursorTo(process.stdout, 0, null)
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
   */
  public static async createManifestFile(manifestPath: string, manifestName: string, manifestVersion: string): Promise<void> {
    const manifest = {
      name: manifestName,
      version: manifestVersion,
      setupDate: Date.now()
    }

    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  }
}
