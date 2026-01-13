import fs from 'node:fs'
import path from 'node:path'
import { spawn, execSync } from 'node:child_process'

import { downloadFile } from 'ipull'

import { TOOLKITS_PATH } from '@bridge/constants'
import { ToolkitConfig } from '@sdk/toolkit-config'
import {
  isWindows,
  isMacOS,
  setHuggingFaceURL,
  formatBytes,
  formatSpeed,
  formatETA,
  formatFilePath
} from '@sdk/utils'
import { leon } from '@sdk/leon'

// Progress callback type for reporting tool progress
export type ProgressCallback = (progress: {
  percentage?: number
  status?: string
  eta?: string
  speed?: string
  size?: string
}) => void

// Command execution options
export interface ExecuteCommandOptions {
  binaryName: string
  args: string[]
  options?: {
    cwd?: string
    timeout?: number
    encoding?: BufferEncoding
    sync?: boolean
  }
  onProgress?: ProgressCallback
  onOutput?: (data: string, isError?: boolean) => void
  skipBinaryDownload?: boolean
}

export abstract class Tool {
  /**
   * Tool name
   */
  abstract get toolName(): string

  /**
   * Toolkit name
   */
  abstract get toolkit(): string

  /**
   * Tool description
   */
  abstract get description(): string

  /**
   * Enable CLI progress display for downloads (logs to stdout instead of stderr to avoid JSON interference)
   */
  protected cliProgress: boolean = true

  /**
   * Report tool status or information using leon.answer with automatic toolkit/tool context
   */
  protected async report(
    key: string,
    data?: Record<string, string | number>,
    toolGroupId?: string
  ): Promise<void> {
    const coreData: Record<string, unknown> = {
      isToolOutput: true,
      toolkitName: this.toolkit,
      toolName: this.toolName
    }

    if (toolGroupId) {
      coreData['toolGroupId'] = toolGroupId
    }

    await leon.answer({
      key,
      data: data || {},
      core: coreData
    })
  }

  /**
   * Escape shell argument by escaping special characters with backslashes
   * This follows the Unix/Linux shell escaping convention
   */
  private escapeShellArg(arg: string): string {
    // Don't escape URLs - they have their own structure
    try {
      new URL(arg)
      // If URL constructor succeeds, it's a valid URL - don't escape it
      return arg
    } catch {
      // Not a valid URL, continue with normal escaping
    }

    if (isWindows()) {
      // Windows: wrap in double quotes and escape internal quotes
      if (
        arg.includes(' ') ||
        arg.includes('"') ||
        arg.includes('&') ||
        arg.includes('|')
      ) {
        return `"${arg.replace(/"/g, '\\"')}"`
      }

      return arg
    }

    // Unix/Linux: escape special characters with backslashes
    return arg.replace(/(["\s'$`\\(){}[\]|&;<>*?!])/g, '\\$1')
  }

  /**
   * Execute a command with proper Leon messaging and progress tracking
   */
  protected async executeCommand(
    options: ExecuteCommandOptions
  ): Promise<string> {
    const {
      binaryName,
      args,
      options: execOptions = {},
      onProgress,
      onOutput,
      skipBinaryDownload
    } = options
    const { sync = false } = execOptions

    // Get binary path (auto-downloads if needed)
    const binaryPath = await this.getBinaryPath(binaryName, skipBinaryDownload)
    const commandString = `"${binaryPath}" ${args
      .map((arg) => this.escapeShellArg(arg))
      .join(' ')}`

    // Generate a unique group ID for this command execution
    const toolGroupId = `${this.toolkit}_${this.toolName}_${Date.now()}`

    await this.report(
      'bridges.tools.executing_command',
      {
        binary_name: binaryName,
        command: commandString
      },
      toolGroupId
    )

    if (sync) {
      return this.executeSyncCommand(
        binaryPath,
        args,
        commandString,
        execOptions,
        toolGroupId
      )
    } else {
      return this.executeAsyncCommand(
        binaryPath,
        args,
        commandString,
        execOptions,
        toolGroupId,
        onProgress,
        onOutput
      )
    }
  }

  /**
   * Execute command synchronously
   */
  private executeSyncCommand(
    binaryPath: string,
    args: string[],
    commandString: string,
    execOptions: ExecuteCommandOptions['options'] = {},
    toolGroupId: string
  ): string {
    try {
      const startTime = Date.now()

      const result = execSync(
        `"${binaryPath}" ${args
          .map((arg) => this.escapeShellArg(arg))
          .join(' ')}`,
        {
          encoding: execOptions.encoding || 'utf8',
          timeout: execOptions.timeout,
          cwd: execOptions.cwd
        }
      )

      const executionTime = Date.now() - startTime

      this.report(
        'bridges.tools.command_completed',
        {
          command: commandString,
          execution_time: `${executionTime}ms`
        },
        toolGroupId
      )

      return result as string
    } catch (error: unknown) {
      this.report(
        'bridges.tools.command_failed',
        {
          command: commandString,
          error: (error as Error).message
        },
        toolGroupId
      )
      throw error
    }
  }

  /**
   * Execute command asynchronously with progress tracking
   */
  private executeAsyncCommand(
    binaryPath: string,
    args: string[],
    commandString: string,
    execOptions: ExecuteCommandOptions['options'] = {},
    toolGroupId: string,
    onProgress?: ProgressCallback,
    onOutput?: (data: string, isError?: boolean) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()
      let outputBuffer = ''

      const childProcess = spawn(binaryPath, args, {
        cwd: execOptions.cwd
      })

      // Handle stdout
      childProcess.stdout.on('data', (data) => {
        const output = data.toString()
        outputBuffer += output

        if (onOutput) {
          onOutput(output, false)
        }

        // Call progress callback if provided
        if (onProgress) {
          onProgress({ status: 'running' })
        }
      })

      // Handle stderr
      childProcess.stderr.on('data', (data) => {
        const output = data.toString()
        outputBuffer += output

        if (onOutput) {
          onOutput(output, true)
        }
      })

      // Handle process completion
      childProcess.on('close', async (code) => {
        const executionTime = Date.now() - startTime

        if (code === 0) {
          await this.report(
            'bridges.tools.command_completed',
            {
              command: commandString,
              execution_time: `${executionTime}ms`
            },
            toolGroupId
          )

          if (onProgress) {
            onProgress({ status: 'completed', percentage: 100 })
          }

          resolve(outputBuffer)
        } else {
          await this.report(
            'bridges.tools.command_failed',
            {
              command: commandString,
              exit_code: code?.toString() ?? 'unknown',
              execution_time: `${executionTime}ms`
            },
            toolGroupId
          )
          reject(
            new Error(`Command failed with exit code ${code}: ${outputBuffer}`)
          )
        }
      })

      // Handle process errors
      childProcess.on('error', async (error) => {
        await this.report(
          'bridges.tools.command_error',
          {
            command: commandString,
            error: error.message
          },
          toolGroupId
        )
        reject(error)
      })

      // Handle timeout
      if (execOptions.timeout) {
        setTimeout(() => {
          childProcess.kill('SIGTERM')
          this.report(
            'bridges.tools.command_timeout',
            {
              command: commandString,
              timeout: `${execOptions.timeout}ms`
            },
            toolGroupId
          )
          reject(new Error(`Command timed out after ${execOptions.timeout}ms`))
        }, execOptions.timeout)
      }
    })
  }

  /**
   * Get binary path and ensure it's downloaded
   */
  async getBinaryPath(
    binaryName: string,
    skipBinaryDownload?: boolean
  ): Promise<string> {
    // For built-in commands like bash, just return the binary name
    if (skipBinaryDownload) {
      return binaryName
    }

    // Get tool name without "Tool" suffix for config lookup
    const toolConfigName = this.toolName.toLowerCase().replace('tool', '')
    const config = ToolkitConfig.load(this.toolkit, toolConfigName)
    const binaryUrl = ToolkitConfig.getBinaryUrl(config)

    await this.report('bridges.tools.checking_binary', {
      binary_name: binaryName
    })

    if (!binaryUrl) {
      await this.report('bridges.tools.no_binary_url', {
        binary_name: binaryName
      })
      throw new Error(`No download URL found for binary '${binaryName}'`)
    }

    // Extract the actual filename from the URL
    const urlPath = new URL(binaryUrl).pathname
    const actualFilename = path.basename(urlPath)
    const executable =
      isWindows() && !actualFilename.endsWith('.exe')
        ? `${actualFilename}.exe`
        : actualFilename

    const binsPath = path.join(TOOLKITS_PATH, this.toolkit, 'bins')

    // Ensure toolkit bins directory exists
    if (!fs.existsSync(binsPath)) {
      await this.report('bridges.tools.creating_bins_directory', {
        toolkit: this.toolkit
      })
      fs.mkdirSync(binsPath, { recursive: true })
    }

    const binaryPath = path.join(binsPath, executable)

    // Ensure binary is available before returning path
    if (!fs.existsSync(binaryPath)) {
      await this.downloadBinaryOnDemand(binaryName, binaryUrl, executable)
    }

    /**
     * Force chmod again in case it has been downloaded but somehow failed
     * so it could not chmod correctly earlier
     */
    if (!isWindows()) {
      await this.report('bridges.tools.applying_permissions', {
        binary_name: binaryName
      })
      fs.chmodSync(binaryPath, 0o755)
    }

    await this.report('bridges.tools.binary_ready', {
      binary_name: binaryName
    })

    return binaryPath
  }

  /**
   * Get resource path and ensure all resource files are downloaded
   * @param resourceName The name of the resource as defined in toolkit.json
   * @returns A promise that resolves to the path of the resource directory
   */
  async getResourcePath(resourceName: string): Promise<string> {
    // Get tool name without "Tool" suffix for config lookup
    const toolConfigName = this.toolName.toLowerCase().replace('tool', '')
    const config = ToolkitConfig.load(this.toolkit, toolConfigName)
    const resourceUrls = config.resources?.[resourceName]

    await this.report('bridges.tools.checking_resource', {
      resource_name: resourceName
    })

    if (
      !resourceUrls ||
      !Array.isArray(resourceUrls) ||
      resourceUrls.length === 0
    ) {
      await this.report('bridges.tools.no_resource_urls', {
        resource_name: resourceName
      })
      throw new Error(`No download URLs found for resource '${resourceName}'`)
    }

    const resourcePath = path.join(
      TOOLKITS_PATH,
      this.toolkit,
      'bins',
      resourceName
    )

    // Ensure toolkit bins directory exists
    if (!fs.existsSync(resourcePath)) {
      await this.report('bridges.tools.creating_resource_directory', {
        resource_name: resourceName,
        resource_path: formatFilePath(resourcePath)
      })

      fs.mkdirSync(resourcePath, { recursive: true })
    }

    // Check if all resource files exist and are complete
    if (this.isResourceComplete(resourcePath, resourceUrls)) {
      await this.report('bridges.tools.resource_already_exists', {
        resource_name: resourceName,
        resource_path: formatFilePath(resourcePath)
      })

      return resourcePath
    }

    await this.report('bridges.tools.downloading_resource', {
      resource_name: resourceName
    })

    // Download each resource file
    for (const resourceUrl of resourceUrls) {
      const adjustedUrl = await setHuggingFaceURL(resourceUrl)

      // Extract filename from URL
      const urlPath = new URL(adjustedUrl).pathname
      const fileName = path.basename(urlPath).split('?')[0] // Remove query parameters

      // Ensure fileName is not empty
      if (!fileName) {
        throw new Error(`Invalid filename extracted from URL: ${adjustedUrl}`)
      }

      const filePath = path.join(resourcePath, fileName)

      await this.report('bridges.tools.downloading_resource_file', {
        resource_name: resourceName,
        file_name: fileName,
        url: adjustedUrl
      })

      try {
        const engine = await downloadFile({
          url: adjustedUrl,
          savePath: filePath,
          cliProgress: false,
          parallelStreams: 3,
          skipExisting: false
        })

        this.listenDownloadProgress(engine, fileName)

        await engine.download()

        await this.report('bridges.tools.resource_file_downloaded', {
          resource_name: resourceName,
          file_name: fileName,
          file_path: filePath
        })
      } catch (error) {
        await this.report('bridges.tools.resource_file_download_failed', {
          resource_name: resourceName,
          file_name: fileName,
          url: adjustedUrl,
          error: (error as Error).message
        })
        throw new Error(
          `Failed to download resource file ${fileName}: ${
            (error as Error).message
          }`
        )
      }
    }

    await this.report('bridges.tools.resource_downloaded', {
      resource_name: resourceName,
      resource_path: formatFilePath(resourcePath)
    })

    return resourcePath
  }

  /**
   * Check if all resource files exist and are not empty
   * @param resourcePath Path to the resource directory
   * @param resourceUrls Array of resource URLs to check against
   * @returns True if all files exist and are not empty, false otherwise
   */
  private isResourceComplete(
    resourcePath: string,
    resourceUrls: string[]
  ): boolean {
    for (const resourceUrl of resourceUrls) {
      const urlPath = new URL(resourceUrl).pathname
      const fileName = path.basename(urlPath).split('?')[0] // Remove query parameters

      // Skip if fileName is empty
      if (!fileName) {
        return false
      }

      const filePath = path.join(resourcePath, fileName)

      if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        return false
      }
    }
    return true
  }

  /**
   * Delete older versions of a binary based on filename pattern
   * Example: if downloading chatterbox_onnx_1.1.0-linux-x86_64, delete chatterbox_onnx_1.0.0-linux-x86_64
   */
  private async deleteOlderBinaryVersions(
    binsPath: string,
    newExecutable: string
  ): Promise<void> {
    try {
      // Parse the new binary filename to extract name, version, and platform
      // Pattern: {name}_{version}-{platform}[.exe]
      const match = newExecutable.match(
        /^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$/
      )

      if (!match) {
        // If filename doesn't match the versioned pattern, skip cleanup
        return
      }

      const [, binaryBaseName, newVersion, platform] = match

      // Get all files in the bins directory
      const files = fs.readdirSync(binsPath)

      for (const file of files) {
        // Check if this file matches the same binary name and platform but different version
        const fileMatch = file.match(/^(.+?)_(\d+\.\d+\.\d+)-(.*?)(?:\.exe)?$/)

        if (!fileMatch) {
          continue
        }

        const [, fileBaseName, fileVersion, filePlatform] = fileMatch

        // Only delete if:
        // 1. Same binary base name
        // 2. Same platform
        // 3. Different version
        if (
          fileBaseName === binaryBaseName &&
          filePlatform === platform &&
          fileVersion !== newVersion
        ) {
          const oldBinaryPath = path.join(binsPath, file)

          await this.report('bridges.tools.deleting_old_version', {
            old_version: file,
            new_version: newExecutable
          })

          fs.unlinkSync(oldBinaryPath)

          await this.report('bridges.tools.old_version_deleted', {
            deleted_file: file
          })
        }
      }
    } catch (error) {
      // Don't fail the entire process if cleanup fails
      await this.report('bridges.tools.cleanup_warning', {
        error: (error as Error).message
      })
    }
  }

  /**
   * Download binary on-demand if not found
   */
  private async downloadBinaryOnDemand(
    binaryName: string,
    binaryUrl: string,
    executable: string
  ): Promise<void> {
    try {
      const binsPath = path.join(TOOLKITS_PATH, this.toolkit, 'bins')
      const binaryPath = path.join(binsPath, executable)

      await this.report('bridges.tools.binary_not_found', {
        binary_name: binaryName
      })

      await this.downloadBinary(binaryUrl, binaryPath)

      await this.report('bridges.tools.binary_downloaded', {
        binary_name: binaryName
      })

      // Delete older versions of this binary
      await this.deleteOlderBinaryVersions(binsPath, executable)

      // Make binary executable (Unix systems)
      if (!isWindows()) {
        await this.report('bridges.tools.making_executable', {
          binary_name: binaryName
        })
        fs.chmodSync(binaryPath, 0o755)
      }

      // Remove quarantine attribute on macOS to prevent Gatekeeper blocking
      if (isMacOS()) {
        await this.removeQuarantineAttribute(binaryPath)
      }
    } catch (error) {
      await this.report('bridges.tools.download_failed', {
        binary_name: binaryName,
        error: (error as Error).message
      })
      throw new Error(
        `Failed to download binary '${binaryName}': ${(error as Error).message}`
      )
    }
  }

  /**
   * Download binary from URL using ipull (faster parallel downloader)
   */
  private async downloadBinary(url: string, outputPath: string): Promise<void> {
    try {
      await this.report('bridges.tools.downloading_from_url')

      // Download the file directly to the output path using ipull
      const engine = await downloadFile({
        url: url,
        savePath: outputPath,
        cliProgress: false,
        parallelStreams: 3,
        skipExisting: false
      })

      this.listenDownloadProgress(engine, path.basename(outputPath))

      // Actually start the download
      await engine.download()
    } catch (error) {
      await this.report('bridges.tools.download_url_failed', {
        error: (error as Error).message
      })
      throw new Error(`Failed to download binary: ${(error as Error).message}`)
    }
  }

  /**
   * Log debug/progress information to stdout with special prefix to avoid being treated as JSON
   * This allows logging without interfering with the JSON communication on stdout
   */
  protected log(message: string, ...args: unknown[]): void {
    // Use a special prefix that the brain can filter out as non-JSON output
    const logMessage = `[LEON_TOOL_LOG] ${message}${
      args.length > 0 ? ' ' + args.join(' ') : ''
    }`
    process.stdout.write(logMessage + '\n')
  }

  /**
   * Setup progress tracking for a download engine if cliProgress is enabled
   * @param engine The download engine from ipull
   * @param fileName The name of the file being downloaded
   */
  private listenDownloadProgress(
    engine: {
      on: (event: string, callback: (progress: unknown) => void) => void
    },
    fileName: string
  ): void {
    if (this.cliProgress) {
      let lastLoggedPercentage = -1
      let lastLogTime = 0
      const LOG_INTERVAL_MS = 2_000 // Log every 2 seconds at most
      const PERCENTAGE_THRESHOLD = 5 // Log every 5% progress

      engine.on('progress', (progress: unknown) => {
        if (progress && typeof progress === 'object' && progress !== null) {
          const progressObj = progress as {
            percentage?: number
            speed?: string | number
            eta?: string | number
            size?: string | number
            transferred?: string | number
          }

          const percentage = Math.round(progressObj.percentage || 0)
          const currentTime = Date.now()

          // Only log if we've made significant progress or enough time has passed
          const shouldLog =
            percentage >= lastLoggedPercentage + PERCENTAGE_THRESHOLD ||
            currentTime - lastLogTime >= LOG_INTERVAL_MS ||
            percentage === 100

          if (shouldLog) {
            const speed = progressObj.speed
              ? formatSpeed(progressObj.speed)
              : ''
            const eta = progressObj.eta ? formatETA(progressObj.eta) : ''

            // Build progress line
            let progressLine = `Downloading ${fileName}: ${percentage}%`

            if (speed) {
              progressLine += ` at ${speed}`
            }

            if (eta && eta !== '∞') {
              progressLine += ` (ETA: ${eta})`
            }

            if (progressObj.size && progressObj.transferred) {
              const totalSize = formatBytes(
                typeof progressObj.size === 'string'
                  ? parseFloat(progressObj.size)
                  : progressObj.size
              )
              const transferredSize = formatBytes(
                typeof progressObj.transferred === 'string'
                  ? parseFloat(progressObj.transferred)
                  : progressObj.transferred
              )
              progressLine += ` [${transferredSize}/${totalSize}]`
            }

            this.log(progressLine)

            lastLoggedPercentage = percentage
            lastLogTime = currentTime
          }
        }
      })

      // Log completion
      const logCompletion = (): void => {
        this.log(`Download completed: ${fileName}`)
      }

      engine.on('finished', logCompletion)
      engine.on('end', logCompletion)
    }
  }

  /**
   * Remove macOS quarantine attribute to prevent Gatekeeper blocking
   */
  private async removeQuarantineAttribute(filePath: string): Promise<void> {
    return new Promise(async (resolve) => {
      try {
        const command = `xattr -d com.apple.quarantine "${filePath}"`

        await this.report('bridges.tools.removing_quarantine', {
          command
        })
        // Use xattr to remove the com.apple.quarantine extended attribute
        const xattr = spawn('xattr', ['-d', 'com.apple.quarantine', filePath])

        xattr.on('close', async (code) => {
          if (code === 0) {
            await this.report('bridges.tools.quarantine_removed', {
              file_name: path.basename(filePath)
            })
          } else {
            // Don't fail the entire process if quarantine removal fails
            await this.report('bridges.tools.quarantine_warning', {
              file_name: path.basename(filePath),
              exit_code: (code ?? 'unknown').toString()
            })
          }

          resolve()
        })

        xattr.on('error', async (error) => {
          // Don't fail the entire process if quarantine removal fails
          await this.report('bridges.tools.quarantine_error', {
            file_name: path.basename(filePath),
            error: error.message
          })

          resolve()
        })
      } catch (error) {
        // Don't fail the entire process if quarantine removal fails
        await this.report('bridges.tools.quarantine_exception', {
          file_name: path.basename(filePath),
          error: (error as Error).message
        })
        resolve()
      }
    })
  }
}
