# Create New Tool for Leon AI

I'm developing Leon AI, an open-source personal AI assistant. It has a granular structure: skills > actions > tools > functions (> binaries).

## Goal

Your goal is to create a new tool. This tool is going to be used by skill actions.
Tools are represented by a class and it contains methods (functions), you must create them.

You must strictly follow the purpose requirement and technical requirements.

This `leon-ai/leon` repository already contains several tools. Feel free to use these existing binaries for your reference to get a better understanding.

## Purpose Requirement

You must create a new tool for `{TOOL_ALIAS_NAME}`. {TOOL_DESCRIPTION}

{TOOL_PURPOSE_REQUIREMENT}

## Technical Requirements

- Tools are located under `tools/{TOOL_TOOLKIT_NAME}/{TOOL_NAME}/src/nodejs` and `tools/{TOOL_TOOLKIT_NAME}/{TOOL_NAME}/src/python`.
- The tool must belong to the `{TOOL_TOOLKIT_NAME}` toolkit.
- Fill the `tools/{TOOL_TOOLKIT_NAME}/{TOOL_NAME}/tool.json` file. You must provide the description, binaries, resources, function definitions by following the OpenAI function-calling standard, etc. Create the file is not created yet.
- You must create the tool with the TypeScript SDK and the Python SDK. The business logic must literally be the same. Start by writting the TypeScript code and then translate/convert to Python for the Python tool.
- Tool file names must be `{TOOL_TS_FILE_NAME}` and `{TOOL_PYTHON_FILE_NAME}`.
- You must reuse the classes and functions provided by the SDK (network, settings, etc.). You will find them in the SDK folder.
- Make sure to understand the parent class of the tool. It is located in `sdk/base-tool.ts` and `sdk/base_tool.py`.
- When creating temporary files, you must not delete them after usage. They will be cleaned up by the OS.

### Binary Tool

If a tool relies on a binary from `leon-ai/leon-binaries`, you must follow these requirements:

1. You must find the tool in this repository: [https://github.com/leon-ai/leon-binaries/tree/main/bins](https://github.com/leon-ai/leon-binaries/tree/main/bins)
2. Then understand its CLI usage via the `README.md` file.
3. Then you must completely analyze and have a deep understanding of the source code that is located in the `run_*.py` file.

For example, for the `qwen3_tts` tool, the README file is located at `https://raw.githubusercontent.com/leon-ai/leon-binaries/refs/heads/main/bins/qwen3_tts/README.md` and the source code file is located at `https://raw.githubusercontent.com/leon-ai/leon-binaries/refs/heads/main/bins/qwen3_tts/run_qwen3_tts.py`

- If the tool has an argument about a PyTorch path, such as `--torch_path`, then use the `PYTORCH_TORCH_PATH` constant from the bridge constants file. You can look at the `qwen3_asr-tool.ts` and `qwen3_asr_tool.py` for reference.
- If the tool has an argument about NVIDIA libs path, such as `--nvidia_libs_path`, then use the `NVIDIA_LIBS_PATH` constant from the bridge constants file. You can look at the `qwen3_asr-tool.ts` and `qwen3_asr_tool.py` for reference.
- If the tool has an argument about resource path, such as `--resource_path`, then use `this.getResourcePath()` and `self.get_resource_path()`. You can look at the `qwen3_asr-tool.ts` and `qwen3_asr_tool.py` for reference.

### Tool References

Some tools rely on binaries (mostly CLIs), some run HTTP API calls, some other RPC, etc.

For your reference and to have a deeper understanding about how tools must be written, you must look at existing tools such as: `qwen3_asr-tool.ts`, `qwen3_asr_tool.py`, `ecapa-tool.ts`, `ecapa_tool.py`, `openai_audio-tool.ts`, `openai_audio_tool.py`, `ytdlp-tool.ts`, `ytdlp_tool.py` and many others.
