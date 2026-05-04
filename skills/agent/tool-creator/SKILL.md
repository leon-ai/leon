---
name: tool-creator
description: Create or modify Leon tools, including binary-backed tools that may require leon-binaries integration.
metadata:
  author: "Louis Grenard <louis@getleon.ai>"
  version: "1.0.0"
---

# Tool Creator

Use this skill when the owner asks Leon to create, update, replace, or repair a tool under `tools/`.

Leon's execution structure is `skills -> actions -> tools -> functions -> binaries`. Tools are reusable classes used by skill actions. Tool methods are exposed as callable functions through each tool's `tool.json` manifest.

## Repositories

Primary Leon repo resolution:

- Treat the current working directory as the starting point.
- Resolve the repo root with `git rev-parse --show-toplevel`.
- Verify it is Leon by checking `package.json`, `tools/`, `skills/`, and a git remote that points to `leon-ai/leon` when available.

Companion binary repo resolution:

- First honor an owner-provided path or environment variable such as `LEON_BINARIES_REPO_PATH` when present.
- Otherwise search sibling and nearby workspace directories for a git repo whose remote points to `leon-ai/leon-binaries`.
- Check common candidates relative to the Leon repo root before doing broader searches, such as `../leon-binaries` and `../../leon-binaries`.
- If the repo is not present locally and binary work is required, run `git clone https://github.com/leon-ai/leon-binaries.git` in a sensible sibling workspace location, then work from that clone.
- Do not assume a machine-specific absolute path.

The binary repo is used for standalone binaries released through `leon-ai/leon-binaries` and referenced from Leon tool manifests.

## Workflow

1. Clarify only when the target tool, toolkit, runtime bridge, or binary source is ambiguous.
2. Inspect existing tools in the target toolkit and related toolkits before designing the new tool.
3. Inspect SDK base classes before using command execution, downloads, resources, settings, or progress callbacks:
   - `bridges/nodejs/src/sdk/base-tool.ts`
   - `bridges/python/src/sdk/base_tool.py`
4. Create or update both bridges unless the owner explicitly asks for one:
   - `tools/{toolkit}/{tool}/src/nodejs/{tool}-tool.ts`
   - `tools/{toolkit}/{tool}/src/python/{tool}_tool.py`
5. Start with the TypeScript implementation, then translate the same business logic to Python.
6. Keep TypeScript and Python behavior equivalent.
7. Update `tools/{toolkit}/{tool}/tool.json`, `settings.sample.json`, `__init__.py`, and Node `index.ts`.
8. In `tool.json`, provide description, binaries, resources, and function definitions with OpenAI-compatible function-calling schemas.
9. Use the required naming convention:
   - TypeScript: `{tool}-tool.ts`
   - Python: `{tool}_tool.py`
10. When creating temporary files, leave them in the OS temp directory after use unless the tool contract requires cleanup. The OS will clean them later, and retained files help debugging.
11. Update `tools/{toolkit}/toolkit.json` when adding or removing a tool.
12. Run `pnpm run lint` after edits and fix every warning or error.

## Binary-Backed Tools

If the tool uses a binary:

1. Inspect `tools/*/*/tool.json` for the current binary URL conventions.
2. Resolve the companion binary repo, then inspect `.github/config/binaries.json` for third-party binary mirroring.
3. Find the binary under the companion repo's `bins/` directory when it is Leon-owned.
4. Read the binary's `README.md` to understand CLI usage and examples.
5. Completely analyze the binary source, usually `run_{binary}.py`, before writing the tool wrapper.
6. If the binary is built from Leon-owned Python code, inspect or create:
   - `bins/{binary}/README.md`
   - `bins/{binary}/run_{binary}.py`
   - `bins/{binary}/{binary}.spec`
   - `bins/{binary}/pyproject.toml`
   - `bins/{binary}/version.py`
7. If the binary is mirrored from an upstream GitHub release, add or update the `binaries.json` mapping:
   - `source_repo`
   - `asset_mappings`
   - `binary_tool_mappings`
8. Map upstream asset names to Leon asset names with this convention:
   - `{binary}_{version}-{os}-{arch}{ext}`
9. Use tool manifest URLs pointing at `https://github.com/leon-ai/leon-binaries/releases/download/{binary}-v{version}/...`.
10. Make sure archive-backed binaries preserve required sidecar files.
11. If the binary accepts a PyTorch path such as `--torch_path`, use `PYTORCH_TORCH_PATH` from bridge constants.
12. If the binary accepts an NVIDIA/CUDA libs path such as `--nvidia_libs_path`, use `NVIDIA_LIBS_PATH` from bridge constants.
13. If the binary accepts a resource path such as `--resource_path`, use `this.getResourcePath()` and `self.get_resource_path()`.
14. Use existing wrappers such as `qwen3_asr`, `qwen3_tts`, and `chatterbox_onnx` as references for binary-backed tools.

## New Leon-Owned Binaries

When creating a new binary in the resolved companion binary repo, preserve the old prompt-template knowledge here instead of regenerating a static prompt file.

Required structure under `bins/{binary}`:

- `README.md`
- `mock/`
- `version.py`
- `run_{binary}.py`
- `{binary}.spec`
- `pyproject.toml`

Creation rules:

- Use `uv`.
- Use the Python version already standardized by the binary repo, currently `3.11.9`, unless the owner explicitly changes it.
- Lock dependency versions.
- Define and document the binary name and exact CLI arguments before implementing.
- Support the standard release targets:
  - Linux x86_64
  - Linux AArch64
  - macOS ARM64
  - macOS x86_64 (Intel)
  - Windows AMD64
- Keep `version.py` simple: `__version__ = "1.0.0"` for a new binary.
- Provide a `README.md` with CLI usage and local resource setup. Do not add extra markdown files.
- Create mock task files under `mock/` so the CLI can be run locally.
- Prefer an ONNX implementation before PyTorch when a viable ONNX model/runtime exists.
- Models and resources from Hugging Face or similar providers must be downloaded up front and loaded from local paths at runtime.
- Avoid embedding unnecessary libraries, model files, caches, test data, or CUDA libraries into the binary.

Runtime and packaging rules:

- Use PyInstaller for compiled binaries and add `pyinstaller==6.18.0` as a dev dependency.
- The `.spec` file must define `PACKAGE_NAME`, `RUN_MAIN_SCRIPT`, `spec_root`, and `main_script` near the top, following existing binaries.
- If CUDA/NVIDIA is supported, load CUDA/NVIDIA libraries dynamically from a CLI path. Use existing binaries such as `qwen3_asr` as the reference.
- If PyTorch is used, implement `--torch_path` and load PyTorch from that path instead of bundling it.
- If a resource directory is needed, implement a CLI argument such as `--resource_path` or the existing binary-specific equivalent.
- On CPU, use available cores sensibly; inspect `chatterbox_onnx` for the current pattern.
- `pyproject.toml` must include the repo's standard sections:
  - `[build-system]` with `hatchling`
  - `[project]` with dynamic version and exact Python requirement
  - `[tool.uv]` with all supported platform environments
  - `[tool.hatch.build.targets.wheel]` with only the runtime files
  - `[tool.hatch.version]`
  - `[dependency-groups]` with dev dependencies
- The `[tool.uv]` environments must cover:
  - `sys_platform == 'linux' and platform_machine == 'x86_64'`
  - `sys_platform == 'linux' and platform_machine == 'aarch64'`
  - `sys_platform == 'darwin' and platform_machine == 'x86_64'`
  - `sys_platform == 'darwin' and platform_machine == 'arm64'`
  - `sys_platform == 'win32' and platform_machine == 'AMD64'`

Dependency guidance from the removed template:

- ONNX: use `onnxruntime-gpu==1.24.1` for Linux x86_64 and Windows AMD64, and `onnxruntime==1.24.1` for other platforms.
- PyTorch: use `torch==2.9.0`, except macOS Intel may need the repo's established older pin. Add `llvmlite==0.43.0` for macOS Intel only when required.
- Transformers: pin `transformers==4.57.6` unless the target project requires another compatible version.

Validation for Leon-owned binaries:

- Run the source script, for example `uv run run_{binary}.py ...`.
- Build with `pnpm run build {binary}` from the binary repo.
- Run the built binary with mock inputs and fix failures before reporting completion.

## leon-binaries Automation

The binary repo has a scheduled/manual workflow:

- `.github/workflows/update-binaries.yml`
- `.github/scripts/update_binaries.py`
- `.github/scripts/update_leon_tools.py`
- `.github/config/binaries.json`
- `.github/data/binary_versions.json`

When replacing a third-party binary, remove its old mapping from `binaries.json` and `binary_versions.json`, then add the new mapping. Do not mark a new binary as already tracked unless the release assets already exist in `leon-ai/leon-binaries`.

## Tool Design Rules

- Prefer existing helpers and SDK APIs.
- Put file-local constants near the top of files.
- Avoid hardcoded ad hoc parsing when a structured API or existing helper exists.
- Validate inputs before expensive binary/model loading.
- Return deterministic paths when a binary postprocesses outputs.
- Keep temporary files in OS temp directories unless the tool contract says otherwise.

## Output

Report the result concisely:

- Tool created or modified.
- Binary repo changes, if any.
- Validation run.
- Suggested commit message.
