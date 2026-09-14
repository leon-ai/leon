import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { afterEach, expect, it, vi, type Mock } from 'vitest'

import { CuaLinuxLaunchAdapter } from '@@/tools/computer_use/cua/src/nodejs/lib/cua/cua-linux-launch'
import type { ComputerUseDriver } from '@@/tools/computer_use/cua/src/nodejs/lib/types'

const directories: string[] = []
const execute = promisify(execFile)

type CallTool = (name: string, argumentsJson: string) => Promise<{ structuredJson: string, isError: boolean }>

async function fixture(): Promise<{ callTool: Mock<CallTool>, adapter: CuaLinuxLaunchAdapter }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'leon-launch-test-'))
  directories.push(directory)
  const callTool = vi.fn<CallTool>(async () => ({
    structuredJson: JSON.stringify({ pid: 42, name: '/bin/sh', windows: [] }), isError: false
  }))
  const native = { callTool } as unknown as ComputerUseDriver
  return { callTool, adapter: new CuaLinuxLaunchAdapter(native, directory) }
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
})

it.skipIf(process.platform !== 'linux')('keeps child output off SDK pipes without evaluating argument text', async () => {
  const { callTool, adapter } = await fixture()
  const text = 'literal $(not-a-command); "quoted"'
  const result = await adapter.callTool('launch_app', JSON.stringify({
    launch_path: process.execPath,
    additional_arguments: ['-e', 'process.stdout.write(process.argv[1]); process.stderr.write("stderr");', text]
  }))
  const parameters = JSON.parse(callTool.mock.calls.at(-1)![1]!)
  const output = await execute(parameters.launch_path, parameters.additional_arguments)
  expect(output.stdout).toBe('')
  expect(output.stderr).toBe('')
  expect(await fs.readFile(JSON.parse(result.structuredJson!).launch_log, 'utf8')).toBe(`${text}stderr`)
})
