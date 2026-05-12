import { spawn } from 'node:child_process'

import { LangHelper } from '@/helpers/lang-helper'
import { LogHelper } from '@/helpers/log-helper'
import { SystemHelper } from '@/helpers/system-helper'
import {
  LANG as LEON_LANG,
  NVIDIA_CUBLAS_PATH,
  NVIDIA_CUDNN_PATH,
  NVIDIA_CUSPARSE_PATH,
  NVIDIA_CUSPARSE_FULL_PATH,
  NVIDIA_NCCL_PATH,
  NVIDIA_NVJITLINK_PATH,
  NVIDIA_NVSHMEM_PATH,
  NVIDIA_LIBS_PATH,
  PYTHON_TCP_SERVER_ENTRY_PATH,
  PYTHON_TCP_SERVER_RUNTIME_BIN_PATH,
  PYTORCH_TORCH_PATH
} from '@/constants'

/**
 * Run the Python TCP server directly from source with Leon's managed Python
 * runtime. This mirrors the production/server boot path.
 */
;(async () => {
  const langArg = process.argv[2] || LangHelper.getShortCode(LEON_LANG)
  const args = [
    PYTHON_TCP_SERVER_ENTRY_PATH,
    langArg,
    '--pytorch-path',
    PYTORCH_TORCH_PATH,
    '--nvidia-path',
    NVIDIA_LIBS_PATH
  ]
  const env = { ...process.env }

  if (SystemHelper.isLinux()) {
    const torchLibPath = `${PYTORCH_TORCH_PATH}/lib`
    const nvidiaLibPaths = [
      `${NVIDIA_CUBLAS_PATH}/lib`,
      `${NVIDIA_CUDNN_PATH}/lib`,
      `${NVIDIA_CUSPARSE_PATH}/lib`,
      `${NVIDIA_CUSPARSE_FULL_PATH}/lib`,
      `${NVIDIA_NCCL_PATH}/lib`,
      `${NVIDIA_NVSHMEM_PATH}/lib`,
      `${NVIDIA_NVJITLINK_PATH}/lib`
    ]

    env['LD_LIBRARY_PATH'] = [torchLibPath, ...nvidiaLibPaths, env['LD_LIBRARY_PATH']]
      .filter(Boolean)
      .join(':')
  }

  const child = spawn(PYTHON_TCP_SERVER_RUNTIME_BIN_PATH, args, {
    stdio: 'inherit',
    env,
    windowsHide: true
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })

  child.on('error', (error) => {
    LogHelper.error(`Failed to start the Python TCP server: ${error}`)
    process.exit(1)
  })
})()
