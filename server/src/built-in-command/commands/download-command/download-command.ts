import path from 'node:path'

import {
  type BuiltInCommandLoadingMessageContext,
  type BuiltInCommandAutocompleteContext,
  type BuiltInCommandAutocompleteItem,
  BuiltInCommand,
  type BuiltInCommandExecutionContext,
  type BuiltInCommandExecutionResult
} from '@/built-in-command/built-in-command'
import { createListResult } from '@/built-in-command/built-in-command-renderer'
import { LLM_DIR_PATH } from '@/constants'
import { FileHelper } from '@/helpers/file-helper'

const DOWNLOADABLE_ASSET_TYPES = ['model']
const MODEL_ASSET_TYPE = 'model'
const DOWNLOAD_LOADING_MESSAGE =
  'Download in progress... Check the terminal logs to review the download progress details.'

function getModelFileNameFromURL(rawURL: string): string {
  const parsedURL = new URL(rawURL)
  const fileName = decodeURIComponent(path.basename(parsedURL.pathname))

  if (!fileName) {
    throw new Error('The model download URL does not include a file name.')
  }

  return fileName
}

export class DownloadCommand extends BuiltInCommand {
  protected override description = 'Download a supported asset into Leon local folders.'
  protected override icon_name = 'ri-download-cloud-2-line'
  protected override supported_usages = [
    '/download',
    '/download model <model_download_url>'
  ]
  protected override help_usage = '/download model <model_download_url>'

  public constructor() {
    super('download')
  }

  public override getLoadingMessage(
    context: BuiltInCommandLoadingMessageContext
  ): string | null {
    const assetType = context.args[0]?.toLowerCase() || ''

    return assetType === MODEL_ASSET_TYPE ? DOWNLOAD_LOADING_MESSAGE : null
  }

  public override getAutocompleteItems(
    context: BuiltInCommandAutocompleteContext
  ): BuiltInCommandAutocompleteItem[] {
    const assetTypeArgument = context.args[0]?.toLowerCase() || ''
    const requestedValue = context.args.slice(1).join(' ').trim()

    if (
      context.args.length === 0 ||
      (context.args.length === 1 && !context.ends_with_space)
    ) {
      return DOWNLOADABLE_ASSET_TYPES.filter((assetType) =>
        assetType.startsWith(assetTypeArgument)
      ).map((assetType) => ({
        type: 'parameter',
        icon_name: this.getIconName(),
        name: assetType,
        description: `Download a ${assetType} asset.`,
        usage: `/download ${assetType} <${assetType}_download_url>`,
        supported_usages: this.getSupportedUsages(),
        value: `/download ${assetType}`
      }))
    }

    if (assetTypeArgument !== MODEL_ASSET_TYPE) {
      return []
    }

    return [
      {
        type: 'parameter',
        icon_name: this.getIconName(),
        name: requestedValue || 'model',
        description: requestedValue
          ? `Download the model from "${requestedValue}".`
          : 'Download a model from a URL.',
        usage: requestedValue
          ? `/download model ${requestedValue}`
          : '/download model <model_download_url>',
        supported_usages: this.getSupportedUsages(),
        value: requestedValue
          ? `/download model ${requestedValue}`
          : '/download model'
      }
    ]
  }

  public override async execute(
    context: BuiltInCommandExecutionContext
  ): Promise<BuiltInCommandExecutionResult> {
    const assetType = context.args[0]?.toLowerCase() || ''
    const assetValue = context.args.slice(1).join(' ').trim()

    if (!assetType) {
      return {
        status: 'completed',
        result: createListResult({
          title: 'Download Assets',
          tone: 'info',
          items: [
            {
              label: 'Supported asset types',
              value: DOWNLOADABLE_ASSET_TYPES.join(', ')
            },
            {
              label: 'Usage',
              value: '/download model <model_download_url>'
            }
          ]
        })
      }
    }

    if (assetType !== MODEL_ASSET_TYPE) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Unsupported Asset Type',
          tone: 'error',
          items: [
            {
              label: `The asset type "${assetType}" is not supported.`,
              tone: 'error'
            },
            {
              label: 'Supported asset types',
              value: DOWNLOADABLE_ASSET_TYPES.join(', '),
              tone: 'error'
            }
          ]
        })
      }
    }

    if (!assetValue) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Missing Download URL',
          tone: 'error',
          items: [
            {
              label: 'Please provide a model download URL.',
              tone: 'error'
            },
            {
              label: 'Usage',
              value: '/download model <model_download_url>',
              tone: 'error'
            }
          ]
        })
      }
    }

    let destinationPath = ''

    try {
      const fileName = getModelFileNameFromURL(assetValue)
      destinationPath = path.join(LLM_DIR_PATH, fileName)

      await FileHelper.downloadFile(assetValue, destinationPath)
    } catch (error) {
      return {
        status: 'error',
        result: createListResult({
          title: 'Download Failed',
          tone: 'error',
          items: [
            {
              label:
                error instanceof Error ? error.message : String(error),
              tone: 'error'
            }
          ]
        })
      }
    }

    return {
      status: 'completed',
      result: createListResult({
        title: 'Download Completed',
        tone: 'success',
        items: [
          {
            label: `The model was downloaded to "${destinationPath}".`,
            tone: 'success'
          },
          {
            label: 'Check the terminal logs to review the download progress details.'
          }
        ]
      })
    }
  }
}
