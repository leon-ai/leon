import json
import os
import tempfile
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

from bridges.python.src.sdk.base_tool import BaseTool, ExecuteCommandOptions
from bridges.python.src.sdk.toolkit_config import ToolkitConfig

# Hardcoded default settings for OpenCode tool
OPENCODE_OPENROUTER_API_KEY = None
OPENCODE_OPENROUTER_MODEL = "openrouter/openai/gpt-5.2-codex"
DEFAULT_SETTINGS = {
    "OPENCODE_OPENROUTER_API_KEY": OPENCODE_OPENROUTER_API_KEY,
    "OPENCODE_OPENROUTER_MODEL": OPENCODE_OPENROUTER_MODEL,
}
REQUIRED_SETTINGS = ["OPENCODE_OPENROUTER_API_KEY"]
OPENCODE_CONFIG_CONTENT = {
    "$schema": "https://opencode.ai/config.json",
    "permission": "allow",
    "provider": {"openrouter": {"options": {"apiKey": ""}}},
}


class OpenCodeTool(BaseTool):
    """OpenCode tool for AI-powered code generation using OpenCode CLI"""

    TOOLKIT = "coding_development"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.providers: Dict[str, Dict[str, Any]] = {}
        tool_settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.settings = tool_settings
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

        openrouter_api_key = tool_settings.get("OPENCODE_OPENROUTER_API_KEY")
        if openrouter_api_key and str(openrouter_api_key).strip():
            OPENCODE_CONFIG_CONTENT["provider"]["openrouter"]["options"]["apiKey"] = (
                openrouter_api_key
            )

        os.environ["OPENCODE_CONFIG_CONTENT"] = json.dumps(OPENCODE_CONFIG_CONTENT)

        # Auto-configure providers from toolkit settings
        self._load_providers_from_settings(self.settings)

        # Provider configurations based on OpenCode documentation
        self.provider_configs = {
            "openrouter": {
                "name": "OpenRouter",
                "default_model": "openrouter/openai/gpt-5.2-codex",
            }
        }

    def _load_providers_from_settings(self, tool_settings: Dict[str, Any]) -> None:
        """Load provider configurations from toolkit settings"""
        provider_settings_map = {
            "openrouter": {
                "api_key_key": "OPENCODE_OPENROUTER_API_KEY",
                "model_key": "OPENCODE_OPENROUTER_MODEL",
                "api_key_default": OPENCODE_OPENROUTER_API_KEY,
                "model_default": OPENCODE_OPENROUTER_MODEL,
            }
        }

        for provider, settings_config in provider_settings_map.items():
            api_key = tool_settings.get(
                settings_config["api_key_key"], settings_config["api_key_default"]
            )
            model = tool_settings.get(
                settings_config["model_key"], settings_config["model_default"]
            )

            if api_key and api_key.strip():
                self.configure_provider(provider, api_key, model)

    @property
    def tool_name(self) -> str:
        return "opencode"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def configure_provider(
        self, provider: str, api_key: str, model: Optional[str] = None
    ) -> None:
        """Configure a provider with API key"""
        if provider not in self.provider_configs:
            raise ValueError(f"Unknown provider: {provider}")

        provider_config = self.provider_configs[provider]
        self.providers[provider] = {
            "name": provider_config["name"],
            "api_key": api_key,
            "model": model or provider_config["default_model"],
        }

    def get_configured_providers(self) -> List[str]:
        """Get list of configured providers"""
        return list(self.providers.keys())

    def get_available_providers(self) -> List[str]:
        """Get list of available providers"""
        return list(self.provider_configs.keys())

    def get_default_model(self, provider: str) -> str:
        """Get default model for a provider"""
        if provider not in self.provider_configs:
            raise ValueError(f"Unknown provider: {provider}")

        return self.provider_configs[provider]["default_model"]

    def _setup_provider_auth(self, provider: str, api_key: str) -> None:
        """Setup OpenCode auth for a provider"""
        auth_file = Path.home() / ".local" / "share" / "opencode" / "auth.json"

        # Ensure directory exists
        auth_file.parent.mkdir(parents=True, exist_ok=True)

        auth_data: Dict[str, Dict[str, str]] = {}

        # Read existing auth if it exists
        if auth_file.exists():
            with open(auth_file, "r") as f:
                auth_data = json.load(f)

        # Add/update provider auth
        auth_data[provider] = {"apiKey": api_key}

        # Write auth file
        with open(auth_file, "w") as f:
            json.dump(auth_data, f, indent=2)

    def _analyze_relevant_toolkits(self, description: str) -> set:
        """Analyze skill description to determine relevant toolkits"""
        description_lower = description.lower()
        relevant_toolkits = set()
        toolkits_dir = Path("tools")

        if not toolkits_dir.exists():
            # Default to coding_development if toolkits directory doesn't exist
            relevant_toolkits.add("coding_development")
            return relevant_toolkits

        try:
            for toolkit_dir in toolkits_dir.iterdir():
                if not toolkit_dir.is_dir():
                    continue

                toolkit_json = toolkit_dir / "toolkit.json"
                if not toolkit_json.exists():
                    continue

                try:
                    with open(toolkit_json) as f:
                        toolkit_data = json.load(f)

                    if not toolkit_data.get("description"):
                        continue

                    # Extract meaningful words from toolkit description
                    toolkit_desc_lower = toolkit_data["description"].lower()
                    toolkit_words = [
                        word
                        for word in toolkit_desc_lower.split()
                        if len(word) > 3  # Filter out short words
                    ]

                    # Also extract words from toolkit name
                    toolkit_name_words = [
                        word
                        for word in (toolkit_data.get("name", "")).lower().split()
                        if len(word) > 3
                    ]

                    # Check if any meaningful words from toolkit match the skill description
                    all_words = toolkit_words + toolkit_name_words
                    for word in all_words:
                        if word in description_lower:
                            relevant_toolkits.add(toolkit_dir.name)
                            break

                except (json.JSONDecodeError, KeyError):
                    continue

            # If no specific toolkits matched, include coding_development as a default
            if not relevant_toolkits:
                relevant_toolkits.add("coding_development")

        except Exception:
            # If we can't scan toolkits, default to coding_development
            relevant_toolkits.add("coding_development")

        return relevant_toolkits

    def _scan_available_toolkits(self, relevant_toolkits: Optional[set] = None) -> str:
        """Scan available toolkits and their tools (optionally filtered)"""
        toolkits_dir = Path("tools")
        toolkit_info = "# Available Leon Tools & Toolkits\n\n"
        toolkit_info += "**IMPORTANT**: You must USE existing tools instead of creating duplicate functionality.\n"
        toolkit_info += "You can EXTEND existing tools with new methods OR create NEW tools when necessary.\n\n"

        if not toolkits_dir.exists():
            toolkit_info += "Could not scan available toolkits. Use existing tools when possible.\n\n"
            return toolkit_info

        try:
            for toolkit_dir in toolkits_dir.iterdir():
                if not toolkit_dir.is_dir():
                    continue

                # Skip if filtering is enabled and this toolkit is not relevant
                if (
                    relevant_toolkits is not None
                    and toolkit_dir.name not in relevant_toolkits
                ):
                    continue

                toolkit_json = toolkit_dir / "toolkit.json"
                if not toolkit_json.exists():
                    continue

                try:
                    with open(toolkit_json) as f:
                        toolkit_data = json.load(f)

                    tools = toolkit_data.get("tools", [])
                    if not tools:
                        continue

                    toolkit_info += f"## {toolkit_data.get('name', toolkit_dir.name)}\n"
                    toolkit_info += (
                        f"{toolkit_data.get('description', 'No description')}\n\n"
                    )

                    for tool_name in tools:
                        tool_manifest = toolkit_dir / tool_name / "tool.json"
                        tool_description = "No description"
                        if tool_manifest.exists():
                            try:
                                with open(tool_manifest, "r", encoding="utf-8") as f:
                                    manifest_data = json.load(f)
                                    tool_description = manifest_data.get(
                                        "description", tool_description
                                    )
                            except json.JSONDecodeError:
                                pass

                        toolkit_info += f"### {tool_name}\n"
                        toolkit_info += f"- **Description**: {tool_description}\n"

                        # Convert to PascalCase for import
                        pascal_name = "".join(
                            word.capitalize()
                            for word in tool_name.replace("-", "_").split("_")
                        )
                        import_path = f"@tools/{toolkit_dir.name}/{tool_name}"
                        toolkit_info += f"- **Import**: `import {pascal_name}Tool from '{import_path}'`\n"

                        toolkit_info += "\n"

                    toolkit_info += "\n"

                except (json.JSONDecodeError, KeyError):
                    continue

        except Exception:
            toolkit_info += "Could not scan available toolkits. Use existing tools when possible.\n\n"

        return toolkit_info

    def _get_tool_methods(self, tool_name: str) -> List[Dict[str, str]]:
        """Get method signatures from a tool file"""
        tools_root = Path("tools")
        tool_path = next(
            tools_root.glob(f"*/{tool_name}/src/nodejs/{tool_name}-tool.ts"),
            None,
        )

        if not tool_path or not tool_path.exists():
            return []

        try:
            with open(tool_path, "r") as f:
                content = f.read()

            methods = []
            # Simple regex to extract public method signatures and JSDoc comments
            method_pattern = r"/\*\*[\s\S]*?\*/\s*(?:async\s+)?(\w+)\s*\([^)]*\):[^{]*"
            matches = re.findall(method_pattern, content)

            for match in matches:
                method_name = match

                # Skip private methods and getters
                if method_name.startswith("_") or method_name == "constructor":
                    continue

                # Extract JSDoc for this method (simplified)
                description = "No description"

                # Look for JSDoc before the method
                jsdoc_match = re.search(
                    r"/\*\*([\s\S]*?)\*/\s*(?:async\s+)?" + re.escape(method_name),
                    content,
                )
                if jsdoc_match:
                    jsdoc_content = jsdoc_match.group(1)
                    desc_match = re.search(r"\*\s*([^@\n]+)", jsdoc_content)
                    if desc_match:
                        description = desc_match.group(1).strip()

                methods.append({"name": method_name, "description": description})

            return methods

        except Exception:
            return []

    def _scan_aurora_components(self) -> str:
        """Scan Aurora SDK components and document their usage"""
        aurora_dir = Path("bridges/nodejs/src/sdk/aurora")
        aurora_doc = ""

        aurora_doc += "# Aurora UI Components\n\n"
        aurora_doc += "# Aurora UI Components\n\n"
        aurora_doc += "Focus on **non-interactive components** (Text, Image, Lists, Loaders, Progress).\n\n"

        try:
            if not aurora_dir.exists():
                aurora_doc += "Could not scan Aurora components. Use Card, Text, Flexbox, List, ListItem, CircularProgress, Progress, and Loader.\n\n"
                return aurora_doc

            component_files = list(aurora_dir.iterdir())
            non_interactive_components = [
                "card",
                "circular-progress",
                "flexbox",
                "icon",
                "image",
                "link",
                "list",
                "list-header",
                "list-item",
                "loader",
                "progress",
                "scroll-container",
                "status",
                "text",
                "widget-wrapper",
            ]

            aurora_doc += "## Available Components\n\n"
            aurora_doc += "**Layout**: Card, Flexbox, ScrollContainer\n"
            aurora_doc += "**Display**: Text, Image, Icon, Link, Status\n"
            aurora_doc += "**Lists**: List, ListItem, ListHeader\n"
            aurora_doc += "**Feedback**: Loader, Progress, CircularProgress\n\n"
            aurora_doc += "**Import**: `from bridges.python.src.sdk.aurora.component_name import ComponentName`\n\n"

            aurora_doc += "## Widget Pattern (Python)\n\n"
            aurora_doc += "```python\n"
            aurora_doc += (
                "from bridges.python.src.sdk.widget import Widget, WidgetOptions\n"
            )
            aurora_doc += "from bridges.python.src.sdk.aurora.flexbox import Flexbox\n"
            aurora_doc += "from bridges.python.src.sdk.aurora.text import Text\n\n"
            aurora_doc += "class MyWidget(Widget[Params]):\n"
            aurora_doc += "    def render(self):\n"
            aurora_doc += "        # Use Flexbox or List as root (NOT Card!)\n"
            aurora_doc += (
                "        return Flexbox({'children': [Text({'children': 'Hello'})]})\n"
            )
            aurora_doc += "```\n\n"

            aurora_doc += "## Common Component Props\n\n"
            aurora_doc += "### Flexbox Props\n"
            aurora_doc += "- `flexDirection`: 'row' | 'column'\n"
            aurora_doc += "- `gap`: 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl'\n"
            aurora_doc += "- `alignItems`: 'start' | 'center' | 'end' | 'stretch'\n"
            aurora_doc += "- `justifyContent`: 'start' | 'center' | 'end' | 'between' | 'around'\n"
            aurora_doc += "- `children`: Array of components\n\n"

            aurora_doc += "### Text Props\n"
            aurora_doc += "- `children`: string (the text content)\n"
            aurora_doc += "- `fontSize`: 'xs' | 'sm' | 'md' | 'lg' | 'xl'\n"
            aurora_doc += "- `fontWeight`: 'normal' | 'medium' | 'semi-bold' | 'bold'\n"
            aurora_doc += "- `secondary`: boolean (muted color)\n\n"

            aurora_doc += "### Card Props\n"
            aurora_doc += "- `children`: Array of components\n"
            aurora_doc += "- `padding`: 'none' | 'sm' | 'md' | 'lg'\n\n"

            aurora_doc += "### CircularProgress Props\n"
            aurora_doc += "- `value`: number (0-100)\n"
            aurora_doc += "- `size`: 'sm' | 'md' | 'lg'\n"
            aurora_doc += "- `children`: string (center text, optional)\n\n"

            aurora_doc += "### Progress Props\n"
            aurora_doc += "- `value`: number (0-100)\n"
            aurora_doc += "- `size`: 'sm' | 'md' | 'lg'\n\n"

            aurora_doc += "### Loader Props\n"
            aurora_doc += "- `size`: 'sm' | 'md' | 'lg'\n\n"

            aurora_doc += "### List Props\n"
            aurora_doc += "- `children`: Array of ListItem components\n\n"

            aurora_doc += "### ListItem Props\n"
            aurora_doc += "- `children`: string | component\n\n"

            aurora_doc += "### ListHeader Props\n"
            aurora_doc += "- `children`: string\n\n"

            aurora_doc += "## Critical Rules (Python)\n\n"
            aurora_doc += "- Root: Flexbox or List (NOT Card!)\n"
            aurora_doc += "- Image props: use 'backgroundSize', 'shape', 'radiusTop'/'radiusBottom' (booleans)\n"
            aurora_doc += "- File: src/widgets/widget_name.py\n\n"

        except Exception:
            aurora_doc += "Could not scan Aurora components. Use Card, Text, Flexbox, List, ListItem, CircularProgress, Progress, and Loader.\n\n"

        return aurora_doc

    def _get_tool_creation_guidelines(self, bridge: str) -> str:
        """Get tool creation and extension guidelines"""
        guidelines = ""

        guidelines += "# Creating New Tools or Extending Existing Tools\n\n"
        guidelines += "You have the ability to create NEW tools or EXTEND existing tools with new methods.\n\n"

        guidelines += "## Decision: When to Create vs Extend\n\n"
        guidelines += "- **Use existing tools**: If a tool already provides the functionality needed\n"
        guidelines += "- **Extend existing tools**: If a tool exists in the right domain but lacks a specific method\n"
        guidelines += "- **Create new tools**: When no existing toolkit/tool covers the domain\n\n"

        guidelines += "## Creating a New Tool\n\n"

        if bridge == "nodejs":
            guidelines += "### TypeScript Tool Structure\n\n"
            guidelines += "Create a new file at `tools/{toolkit_name}/{tool_name}/src/nodejs/{tool_name}-tool.ts`:\n\n"
            guidelines += "```typescript\n"
            guidelines += "import { Tool } from '@sdk/base-tool'\n"
            guidelines += "import { ToolkitConfig } from '@sdk/toolkit-config'\n\n"
            guidelines += "export default class MyNewTool extends Tool {\n"
            guidelines += "  private static readonly TOOLKIT = 'toolkit_name'  // e.g., 'music_audio'\n"
            guidelines += (
                "  private readonly config: ReturnType<typeof ToolkitConfig.load>\n\n"
            )
            guidelines += "  constructor() {\n"
            guidelines += "    super()\n"
            guidelines += "    this.config = ToolkitConfig.load(MyNewTool.TOOLKIT, this.toolName)\n"
            guidelines += "  }\n\n"
            guidelines += "  get toolName(): string {\n"
            guidelines += "    return 'mynew'  # Hardcode tool name\n"
            guidelines += "  }\n\n"
            guidelines += "  get toolkit(): string {\n"
            guidelines += "    return MyNewTool.TOOLKIT\n"
            guidelines += "  }\n\n"
            guidelines += "  get description(): string {\n"
            guidelines += "    return this.config['description']\n"
            guidelines += "  }\n\n"
            guidelines += "  /**\n"
            guidelines += "   * Your tool method\n"
            guidelines += "   */\n"
            guidelines += "  async myMethod(param: string): Promise<string> {\n"
            guidelines += "    // Implementation\n"
            guidelines += (
                "    // If the tool needs a binary, use this.executeCommand()\n"
            )
            guidelines += "    return 'result'\n"
            guidelines += "  }\n"
            guidelines += "}\n"
            guidelines += "```\n\n"
        else:
            guidelines += "### Python Tool Structure\n\n"
            guidelines += "Create a new file at `tools/{toolkit_name}/{tool_name}/src/python/{tool_name}_tool.py`:\n\n"
            guidelines += "```python\n"
            guidelines += "from bridges.python.src.sdk.base_tool import BaseTool\n"
            guidelines += "from bridges.python.src.sdk.toolkit_config import ToolkitConfig\n\n"
            guidelines += "class MyNewTool(BaseTool):\n"
            guidelines += "    TOOLKIT = 'toolkit_name'  # e.g., 'music_audio'\n\n"
            guidelines += "    def __init__(self):\n"
            guidelines += "        super().__init__()\n"
            guidelines += "        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)\n\n"
            guidelines += "    @property\n"
            guidelines += "    def tool_name(self) -> str:\n"
            guidelines += "        return 'mynew'  # Hardcode tool name\n\n"
            guidelines += "    @property\n"
            guidelines += "    def toolkit(self) -> str:\n"
            guidelines += "        return self.TOOLKIT\n\n"
            guidelines += "    @property\n"
            guidelines += "    def description(self) -> str:\n"
            guidelines += "        return self.config['description']\n\n"
            guidelines += "    def my_method(self, param: str) -> str:\n"
            guidelines += "        # Implementation\n"
            guidelines += "        return 'result'\n"
            guidelines += "```\n\n"

        guidelines += "### Register New Tool\n\n"
        guidelines += (
            "1) Add tool id to `tools/{toolkit_name}/toolkit.json`:\n\n"
        )
        guidelines += "```json\n"
        guidelines += "{\n"
        guidelines += '  "name": "Toolkit Name",\n'
        guidelines += '  "description": "Description",\n'
        guidelines += '  "tools": ["mynew"]\n'
        guidelines += "}\n"
        guidelines += "```\n\n"

        guidelines += "2) Create tool manifest `tools/{toolkit_name}/mynew/tool.json`:\n\n"
        guidelines += "```json\n"
        guidelines += "{\n"
        guidelines += '  "$schema": "../../../schemas/tool-schemas/tool.json",\n'
        guidelines += '  "tool_id": "mynew",\n'
        guidelines += '  "toolkit_id": "{toolkit_name}",\n'
        guidelines += '  "name": "My New Tool",\n'
        guidelines += '  "description": "My new tool description",\n'
        guidelines += '  "author": { "name": "Your Name" },\n'
        guidelines += '  "binaries": {\n'
        guidelines += '    "linux-x86_64": "https://url-to-binary.tar.gz"\n'
        guidelines += "  },\n"
        guidelines += '  "functions": {\n'
        guidelines += '    "my_method": {\n'
        guidelines += '      "description": "My method description",\n'
        guidelines += '      "input_schema": { "param": "string" }\n'
        guidelines += "    }\n"
        guidelines += "  }\n"
        guidelines += "}\n"
        guidelines += "```\n\n"

        guidelines += "## Extending an Existing Tool\n\n"
        guidelines += "To add a new method to an existing tool:\n\n"

        if bridge == "nodejs":
            guidelines += "1. Open the existing tool file (e.g., `tools/video_streaming/ytdlp/src/nodejs/ytdlp-tool.ts`)\n"
            guidelines += "2. Add your new method to the class:\n\n"
            guidelines += "```typescript\n"
            guidelines += "  /**\n"
            guidelines += "   * My new method description\n"
            guidelines += "   */\n"
            guidelines += "  async myNewMethod(param: string): Promise<string> {\n"
            guidelines += "    // Use this.executeCommand() for binary tools\n"
            guidelines += "    const result = await this.executeCommand({\n"
            guidelines += "      binaryName: 'yt-dlp',\n"
            guidelines += "      args: ['--param', param],\n"
            guidelines += "      options: { sync: true }\n"
            guidelines += "    })\n"
            guidelines += "    return result\n"
            guidelines += "  }\n"
            guidelines += "```\n\n"
        else:
            guidelines += "1. Open the existing tool file (e.g., `tools/video_streaming/ytdlp/src/python/ytdlp_tool.py`)\n"
            guidelines += "2. Add your new method to the class:\n\n"
            guidelines += "```python\n"
            guidelines += "    def my_new_method(self, param: str) -> str:\n"
            guidelines += '        """My new method description"""\n'
            guidelines += "        # Use self.execute_command() for binary tools\n"
            guidelines += "        result = self.execute_command(\n"
            guidelines += "            binary_name='yt-dlp',\n"
            guidelines += "            args=['--param', param]\n"
            guidelines += "        )\n"
            guidelines += "        return result\n"
            guidelines += "```\n\n"

        guidelines += "## Important Notes\n\n"
        guidelines += "- **Never duplicate**: Check existing tools first before creating new ones\n"
        guidelines += "- **Toolkit placement**: Choose the right toolkit (e.g., audio tools go in music_audio)\n"
        guidelines += "- **Binary tools**: If your tool wraps a CLI binary, use `executeCommand()`\n"
        guidelines += "- **Pure code tools**: If no binary is needed, implement the logic directly\n"
        guidelines += "- **Method naming**: Use clear, descriptive names (e.g., `downloadVideo`, `extractAudio`)\n\n"

        return guidelines

    def _build_leon_context(
        self,
        description: str,
        system_prompt: Optional[str] = None,
        context_files: Optional[List[str]] = None,
        bridge: str = "nodejs",
    ) -> str:
        """Build Leon-specific context for OpenCode from template"""
        try:
            system_prompt_section = (
                f"# System Instructions\n\n{system_prompt}\n\n" if system_prompt else ""
            )
            relevant_toolkits = self._analyze_relevant_toolkits(description)
            toolkit_info = self._scan_available_toolkits(relevant_toolkits)
            repo_snapshot = self._build_repo_snapshot(context_files or [])
            reference_files_section = self._build_reference_files_section(
                context_files or []
            )
            language = "TypeScript" if bridge == "nodejs" else "Python"
            file_extension = ".ts" if bridge == "nodejs" else ".py"
            bridge_name = "Node.js" if bridge == "nodejs" else "Python"
            bridge_path = "nodejs" if bridge == "nodejs" else "python"
            tool_creation_guidelines = self._get_tool_creation_guidelines(bridge)
            aurora_components = self._scan_aurora_components()
            template = self._load_prompt_template()

            return self._apply_template(
                template,
                {
                    "SYSTEM_PROMPT_SECTION": system_prompt_section,
                    "REPO_SNAPSHOT": repo_snapshot,
                    "TOOLKIT_INFO": toolkit_info,
                    "LANGUAGE": language,
                    "FILE_EXTENSION": file_extension,
                    "BRIDGE": bridge,
                    "BRIDGE_NAME": bridge_name,
                    "BRIDGE_PATH": bridge_path,
                    "BRIDGE_SPECIFIC_GUIDELINES": self._build_bridge_specific_guidelines(
                        bridge, file_extension
                    ),
                    "SETTINGS_USAGE_EXAMPLE": self._build_settings_usage_example(
                        bridge
                    ),
                    "BATCH_PROCESSING_EXAMPLE": self._build_batch_processing_example(
                        bridge
                    ),
                    "TOOL_CREATION_GUIDELINES": tool_creation_guidelines,
                    "AURORA_COMPONENTS": aurora_components,
                    "LEON_ANSWER_BASIC_EXAMPLE": self._build_leon_answer_basic_example(
                        bridge
                    ),
                    "CONTEXT_DATA_EXAMPLE": self._build_context_data_example(bridge),
                    "ACTION_PARAMS_EXAMPLE": self._build_action_params_example(bridge),
                    "REFERENCE_FILES_SECTION": reference_files_section,
                },
            )
        except Exception:
            return self._build_leon_context_legacy(
                description, system_prompt, context_files, bridge
            )

    def _load_prompt_template(self) -> str:
        template_path = Path(__file__).parent / "lib" / "prompt.md"
        return template_path.read_text(encoding="utf-8")

    def _apply_template(self, template: str, values: Dict[str, str]) -> str:
        output = template
        for key, value in values.items():
            output = re.sub(r"{{\s*" + re.escape(key) + r"\s*}}", value, output)
        return output

    def _build_bridge_specific_guidelines(
        self, bridge: str, file_extension: str
    ) -> str:
        if bridge == "nodejs":
            return (
                "- **Tool usage**: Import tools like `import YtdlpTool from '@tools/video_streaming/ytdlp'`\n"
                "- **SDK imports**: @sdk/types, @sdk/leon, @sdk/params-helper\n"
                "- **Action structure**: Export a `run` function as the action entry point\n"
                "- **Responses**: Use leon.answer() to respond to users\n"
                f"- **File extensions**: ALL files MUST use {file_extension} (actions, widgets, utilities)\n"
                "- **Extra files**: Put shared helpers in src/lib; only action entry points go in src/actions\n"
                f"- **File structure**: skill.json + locales/en.json + src/actions/*{file_extension} + src/widgets/*{file_extension} + src/lib/*{file_extension}\n"
            )

        return (
            "- **Tool usage**: Import tools like `from tools.video_streaming.ytdlp import YtdlpTool`\n"
            "- **SDK imports**: from bridges.python.src.sdk.leon import leon; from bridges.python.src.sdk.types import ActionParams; from bridges.python.src.sdk.params_helper import ParamsHelper\n"
            "- **Action structure**: Define a `run` function as the action entry point\n"
            "- **Responses**: Use leon.answer() to respond to users\n"
            f"- **File extensions**: ALL files MUST use {file_extension} (actions, widgets, utilities)\n"
            "- **Extra files**: Put shared helpers in src/lib; only action entry points go in src/actions\n"
            f"- **File structure**: skill.json + locales/en.json + src/actions/*{file_extension} + src/widgets/*{file_extension} + src/lib/*{file_extension}\n"
        )

    def _build_settings_usage_example(self, bridge: str) -> str:
        if bridge == "nodejs":
            return (
                "```typescript\n"
                "import { Settings } from '@sdk/settings'\n"
                "import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'\n"
                "import OpenRouterTool from '@tools/communication/openrouter'\n\n"
                "interface MySkillSettings extends Record<string, unknown> {\n"
                "  provider_model?: string\n"
                "  max_tokens?: number\n"
                "}\n\n"
                "export const run: ActionFunction = async function (params, paramsHelper) {\n"
                "  const settings = new Settings<MySkillSettings>()\n"
                "  const model = (await settings.get('provider_model')) || 'default-model'\n"
                "  const maxTokens = (await settings.get('max_tokens')) || 1000\n\n"
                "  let tool: OpenRouterTool\n"
                "  try {\n"
                "    tool = await ToolManager.initTool(OpenRouterTool)\n"
                "  } catch (error) {\n"
                "    if (isMissingToolSettingsError(error)) return\n"
                "    throw error\n"
                "  }\n\n"
                "  // Use tool + settings...\n"
                "  // On errors, include: core: { should_stop_skill: true }\n"
                "}\n"
                "```\n\n"
            )

        return (
            "```python\n"
            "from bridges.python.src.sdk.tool_manager import ToolManager, is_missing_tool_settings_error\n"
            "from bridges.python.src.sdk.types import ActionParams\n"
            "from bridges.python.src.sdk.settings import Settings\n"
            "from tools.communication.openrouter import OpenRouterTool\n\n"
            "def run(params: ActionParams, params_helper: ParamsHelper) -> None:\n"
            "    settings = Settings()\n"
            "    model = settings.get('provider_model') or 'default-model'\n"
            "    max_tokens = settings.get('max_tokens') or 1000\n\n"
            "    try:\n"
            "        tool = ToolManager.init_tool(OpenRouterTool)\n"
            "    except Exception as error:\n"
            "        if is_missing_tool_settings_error(error):\n"
            "            return\n"
            "        raise\n\n"
            "    # Use tool + settings...\n"
            "```\n\n"
        )

    def _build_batch_processing_example(self, bridge: str) -> str:
        if bridge == "nodejs":
            return (
                "```typescript\n"
                "// DON'T DO THIS - Inefficient!\n"
                "for (const segment of segments) {\n"
                "  await chatterbox.synthesizeSpeechToFiles({\n"
                "    text: segment.text,\n"
                "    audio_path: segment.path\n"
                "  })\n"
                "}\n"
                "```\n\n"
                "[CORRECT] - Single batch call (FAST):\n"
                "```typescript\n"
                "// DO THIS - Read the tool to discover it accepts an array!\n"
                "const tasks = segments.map(segment => ({\n"
                "  text: segment.text,\n"
                "  audio_path: segment.path,\n"
                "  voice_name: segment.voice\n"
                "}))\n\n"
                "// Single call processes all segments efficiently\n"
                "await chatterbox.synthesizeSpeechToFiles(tasks)\n"
                "```\n\n"
            )

        return (
            "```python\n"
            "# DON'T DO THIS - Inefficient!\n"
            "for segment in segments:\n"
            "    chatterbox.synthesize_speech_to_files({\n"
            "        'text': segment['text'],\n"
            "        'audio_path': segment['path']\n"
            "    })\n"
            "```\n\n"
            "[CORRECT] - Single batch call (FAST):\n"
            "```python\n"
            "# DO THIS - Read the tool to discover it accepts a list!\n"
            "tasks = [{\n"
            "    'text': segment['text'],\n"
            "    'audio_path': segment['path'],\n"
            "    'voice_name': segment['voice']\n"
            "} for segment in segments]\n\n"
            "# Single call processes all segments efficiently\n"
            "chatterbox.synthesize_speech_to_files(tasks)\n"
            "```\n\n"
        )

    def _build_leon_answer_basic_example(self, bridge: str) -> str:
        if bridge == "nodejs":
            return (
                "```typescript\n"
                "// Simple text response with localized message key\n"
                "leon.answer({\n"
                "  key: 'success_message',\n"
                "  data: {\n"
                "    file_name: 'example.mp4',\n"
                "    file_size: '25 MB'\n"
                "  }\n"
                "})\n"
                "```\n\n"
            )

        return (
            "```python\n"
            "# Simple text response with localized message key\n"
            "leon.answer({\n"
            "  'key': 'success_message',\n"
            "  'data': {\n"
            "    'file_name': 'example.mp4',\n"
            "    'file_size': '25 MB'\n"
            "  }\n"
            "})\n"
            "```\n\n"
        )

    def _build_context_data_example(self, bridge: str) -> str:
        if bridge == "nodejs":
            return (
                "```typescript\n"
                "// Action 1: Download video and pass path to next action\n"
                "leon.answer({\n"
                "  key: 'download_completed',\n"
                "  data: {\n"
                "    file_path: formatFilePath(videoPath)\n"
                "  },\n"
                "  core: {\n"
                "    context_data: {\n"
                "      video_path: videoPath,           // Pass full path\n"
                "      target_language: targetLanguage, // Pass other needed data\n"
                "      quality: quality\n"
                "    }\n"
                "  }\n"
                "})\n\n"
                "// Action 2: Retrieve data from previous action\n"
                "const videoPath = paramsHelper.getContextData<string>('video_path')\n"
                "const targetLanguage = paramsHelper.getContextData<string>('target_language')\n"
                "```\n\n"
            )

        return (
            "```python\n"
            "# Action 1: Download video and pass path to next action\n"
            "leon.answer({\n"
            "  'key': 'download_completed',\n"
            "  'data': {\n"
            "    'file_path': format_file_path(video_path)\n"
            "  },\n"
            "  'core': {\n"
            "    'context_data': {\n"
            "      'video_path': video_path,           # Pass full path\n"
            "      'target_language': target_language, # Pass other needed data\n"
            "      'quality': quality\n"
            "    }\n"
            "  }\n"
            "})\n\n"
            "# Action 2: Retrieve data from previous action\n"
            "video_path = params_helper.get_context_data('video_path')\n"
            "target_language = params_helper.get_context_data('target_language')\n"
            "```\n\n"
        )

    def _build_action_params_example(self, bridge: str) -> str:
        if bridge == "nodejs":
            return (
                "```typescript\n"
                "import type { ActionFunction } from '@sdk/types'\n"
                "import { leon } from '@sdk/leon'\n"
                "import { ParamsHelper } from '@sdk/params-helper'\n\n"
                "export const run: ActionFunction = async function (\n"
                "  params,\n"
                "  paramsHelper: ParamsHelper\n"
                ") {\n"
                "  // Get action arguments defined in skill.json parameters\n"
                "  const location = paramsHelper.getActionArgument('location') as string\n"
                "  const units = paramsHelper.getActionArgument('units') as string | undefined\n\n"
                "  // Access raw params if needed\n"
                "  const utterance = params.utterance\n"
                "  const lang = params.lang\n"
                "}\n"
                "```\n\n"
            )

        return (
            "```python\n"
            "from bridges.python.src.sdk.leon import leon\n"
            "from bridges.python.src.sdk.types import ActionParams\n"
            "from bridges.python.src.sdk.params_helper import ParamsHelper\n\n"
            "def run(params: ActionParams, params_helper: ParamsHelper) -> None:\n"
            "    # Get action arguments defined in skill.json parameters\n"
            "    location = params_helper.get_action_argument('location')\n"
            "    units = params_helper.get_action_argument('units')\n\n"
            "    # Access raw params if needed\n"
            "    utterance = params.get('utterance')\n"
            "    lang = params.get('lang')\n"
            "```\n\n"
        )

    def _build_reference_files_section(self, context_files: List[str]) -> str:
        if not context_files:
            return ""
        lines = ["# Reference Files\n", "Please study these example files:"]
        lines.extend([f"- {file}" for file in context_files])
        return "\n".join(lines) + "\n\n"

    def _build_repo_snapshot(self, context_files: List[str]) -> str:
        root_dir = Path.cwd()
        try:
            root_entries = sorted(
                [entry.name for entry in root_dir.iterdir() if entry.is_dir()]
            )
        except Exception:
            root_entries = []

        skills_updated_at = self._get_latest_mtime(root_dir / "skills")
        toolkits_updated_at = self._get_latest_mtime(root_dir / "tools")

        context_file_lines = self._get_context_file_snapshot(context_files)
        lines = [
            "# Repository Snapshot (Quick)\n",
            f"Generated: {datetime.utcnow().isoformat()}Z",
            f"Root: {root_dir}",
            f"Top-level directories: {', '.join(root_entries) if root_entries else 'n/a'}",
            f"skills/ updated: {self._format_snapshot_date(skills_updated_at)}",
            f"tools/ updated: {self._format_snapshot_date(toolkits_updated_at)}",
        ]

        if context_file_lines:
            lines.append("Context files:")
            lines.extend([f"- {line}" for line in context_file_lines])

        return "\n".join(lines) + "\n\n"

    def _format_snapshot_date(self, value: Optional[float]) -> str:
        return (
            datetime.utcfromtimestamp(value).isoformat() + "Z" if value else "unknown"
        )

    def _get_latest_mtime(self, dir_path: Path) -> Optional[float]:
        try:
            entries = list(dir_path.iterdir())
            if not entries:
                return None
            latest = max(entry.stat().st_mtime for entry in entries)
            return latest
        except Exception:
            return None

    def _get_context_file_snapshot(self, context_files: List[str]) -> List[str]:
        snapshots = []
        for file in context_files:
            full_path = Path.cwd() / file
            try:
                mtime = full_path.stat().st_mtime
                snapshots.append(
                    f"{file} (modified {datetime.utcfromtimestamp(mtime).isoformat()}Z)"
                )
            except Exception:
                snapshots.append(f"{file} (missing)")
        return snapshots

    def _build_leon_context_legacy(
        self,
        description: str,
        system_prompt: Optional[str] = None,
        context_files: Optional[List[str]] = None,
        bridge: str = "nodejs",
    ) -> str:
        """Build Leon-specific context for OpenCode"""
        context = ""

        if system_prompt:
            context += f"# System Instructions\n\n{system_prompt}\n\n"

        # Analyze and determine relevant toolkits based on skill description
        relevant_toolkits = self._analyze_relevant_toolkits(description)

        # Add available toolkits and tools information (filtered by relevance)
        context += self._scan_available_toolkits(relevant_toolkits)

        language = "TypeScript" if bridge == "nodejs" else "Python"
        file_extension = ".ts" if bridge == "nodejs" else ".py"

        context += "# Leon Skill Development Guidelines\n\n"
        context += f"You are generating code for Leon AI assistant using **{language}**. Follow these guidelines:\n\n"
        context += f"- **Language**: CRITICAL - Write ALL skill source code in {language} (actions, widgets, utilities, everything)\n"
        context += f"- **Bridge**: Use the {'Node.js' if bridge == 'nodejs' else 'Python'} bridge\n"
        context += f"- **Consistency**: The bridge setting ({bridge}) applies to the ENTIRE skill - all actions, widgets, and utilities must use {language}\n"
        context += "- **Skill Location**: CRITICAL - Create skills directly in the `skills/` folder, NOT in subfolders\n"
        context += "- **Use existing tools**: Check the tools listed above first! Don't recreate functionality.\n"
        context += "- **DON'T modify tools**: Never edit existing tool files. Only use them in your actions.\n"

        if bridge == "nodejs":
            context += "- **Tool usage**: Import tools like `import YtdlpTool from '@tools/video_streaming/ytdlp'`\n"
            context += "- **SDK imports**: @sdk/types, @sdk/leon, @sdk/params-helper\n"
            context += "- **Action structure**: Export a `run` function as the action entry point\n"
            context += "- **Responses**: Use leon.answer() to respond to users\n"
            context += f"- **File extensions**: ALL files MUST use {file_extension} (actions, widgets, utilities)\n"
            context += "- **Extra files**: Put shared helpers in src/lib; only action entry points go in src/actions\n"
            context += f"- **File structure**: skill.json + locales/en.json + src/actions/*{file_extension} + src/widgets/*{file_extension} + src/lib/*{file_extension}\n"
        else:
            context += "- **Tool usage**: Import tools like `from tools.video_streaming.ytdlp import YtdlpTool`\n"
            context += "- **SDK imports**: from bridges.python.src.sdk.leon import leon; from bridges.python.src.sdk.types import ActionParams; from bridges.python.src.sdk.params_helper import ParamsHelper\n"
            context += "- **Action structure**: Define a `run` function as the action entry point\n"
            context += "- **Responses**: Use leon.answer() to respond to users\n"
            context += f"- **File extensions**: ALL files MUST use {file_extension} (actions, widgets, utilities)\n"
            context += "- **Extra files**: Put shared helpers in src/lib; only action entry points go in src/actions\n"
            context += f"- **File structure**: skill.json + locales/en.json + src/actions/*{file_extension} + src/widgets/*{file_extension} + src/lib/*{file_extension}\n"

        context += "- **Validation**: Validate against schemas in ../../schemas/skill-schemas/\n\n"

        context += "# Skill Directory Structure - CRITICAL\n\n"
        context += "**IMPORTANT**: Skills must be created directly in the `skills/` root folder.\n\n"
        context += "## Correct Structure\n\n"
        context += "```\n"
        context += "skills/\n"
        context += "├── my_skill_name/           # ✅ Directly in skills/ folder\n"
        context += "│   ├── skill.json\n"
        context += "│   ├── locales/\n"
        context += "│   │   └── en.json\n"
        context += "│   └── src/\n"
        context += "│       ├── settings.sample.json\n"
        context += "│       ├── settings.json\n"
        context += "│       ├── actions/\n"
        context += f"│       │   └── action_name{file_extension}\n"
        context += "│       ├── lib/             # Helpers/utilities\n"
        context += f"│       │   └── helpers{file_extension}\n"
        context += "│       └── widgets/         # Optional\n"
        context += f"│           └── widget_name{file_extension}\n"
        context += "```\n\n"
        context += "## WRONG - Do NOT Create Skills in Subfolders\n\n"
        context += "```\n"
        context += "skills/\n"
        context += (
            "├── utilities/               # ❌ WRONG - Don't use category subfolders\n"
        )
        context += "│   └── my_skill/\n"
        context += "├── entertainment/           # ❌ WRONG\n"
        context += "│   └── my_skill/\n"
        context += "```\n\n"
        context += "**Key Rules:**\n"
        context += (
            "1. Skills go directly in `skills/skill_name/` (no intermediate folders)\n"
        )
        context += "2. Skill folder name should be lowercase with underscores (e.g., `video_translator_skill`)\n"
        context += "3. Always end skill folder name with `_skill` suffix\n"
        context += f"4. CRITICAL: ALL source files use {file_extension} - actions, widgets, utilities (bridge={bridge})\n\n"

        context += f"## Bridge Consistency - ABSOLUTELY CRITICAL\n\n"
        context += f'**VERY IMPORTANT**: When bridge is set to "{bridge}", ALL skill source code MUST be in {language}.\n\n'
        context += "**This means:**\n"
        context += f"- Actions: {file_extension} ({language})\n"
        context += f"- Widgets: {file_extension} ({language})\n"
        context += f"- Utilities: {file_extension} ({language})\n"
        context += f"- Helper functions: {file_extension} ({language})\n"
        context += "- NEVER mix TypeScript and Python in the same skill!\n\n"
        context += "**Wrong Example (DO NOT DO THIS):**\n"
        context += "```\n"
        context += "src/\n"
        context += "├── actions/\n"
        context += "│   └── my_action.py        # ❌ Python\n"
        context += "└── widgets/\n"
        context += "    └── my_widget.ts         # ❌ TypeScript - INCONSISTENT!\n"
        context += "```\n\n"
        context += "**Correct Example:**\n"
        context += "```\n"
        context += "src/\n"
        context += "├── actions/\n"
        context += f"│   └── my_action{file_extension}      # ✅ {language}\n"
        context += "└── widgets/\n"
        context += (
            f"    └── my_widget{file_extension}       # ✅ {language} - CONSISTENT!\n"
        )
        context += "```\n\n"

        # Add JSON file schema requirements
        context += "# JSON File Schema References - CRITICAL\n\n"
        context += "**IMPORTANT**: All JSON configuration files MUST include schema references at the beginning.\n\n"

        context += "## Required Schema References\n\n"

        context += "### skill.json - COMPLETE STRUCTURE (Based on schemas/skill-schemas/skill.json)\n\n"
        context += "**CRITICAL**: Understanding skill.json structure is essential for creating skills correctly.\n\n"

        context += "## When to Use Flow vs Direct Actions\n\n"
        context += "### Use Direct Actions (No Flow) When:\n"
        context += '- **Single-step tasks**: Skill has only one action (e.g., "generate podcast")\n'
        context += "- **Independent actions**: Each action is standalone, not part of a sequence\n"
        context += "- **Simple skills**: No multi-step workflows needed\n\n"

        context += "### Use Flow When:\n"
        context += "- **Multi-step workflows**: Actions must be executed in a specific sequence\n"
        context += (
            "- **Data passing**: One action's output is needed by the next action\n"
        )
        context += "- **Complex processes**: Like video translation (download → transcribe → translate → synthesize → merge)\n\n"

        context += "## skill.json Structure Examples\n\n"

        context += "### Example 1: Simple Skill (No Flow) - Single Action\n"
        context += (
            "Use this when the skill has only one action or independent actions:\n\n"
        )
        context += "```json\n{\n"
        context += '  "$schema": "../../schemas/skill-schemas/skill.json",\n'
        context += '  "name": "Podcast Generator",\n'
        context += '  "bridge": "nodejs",\n'
        context += '  "version": "1.0.0",\n'
        context += '  "description": "Generate podcast conversations on any topic.",\n'
        context += '  "author": {\n'
        context += '    "name": "Your Name",\n'
        context += '    "email": "your.email@example.com"\n'
        context += "  },\n"
        context += '  "actions": {\n'
        context += '    "generate": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Generate a podcast conversation on any topic with customizable duration.",\n'
        context += '      "parameters": {\n'
        context += '        "topic": {\n'
        context += '          "type": "string",\n'
        context += '          "description": "The topic to discuss in the podcast."\n'
        context += "        },\n"
        context += '        "duration": {\n'
        context += '          "type": "number",\n'
        context += '          "description": "Duration in minutes (1-5)."\n'
        context += "        }\n"
        context += "      },\n"
        context += '      "optional_parameters": ["duration"]\n'
        context += "    }\n"
        context += "  }\n"
        context += "}\n```\n\n"

        context += "### Example 2: Complex Skill with Flow - Multi-Step Workflow\n"
        context += "Use this when actions must execute in sequence and share data:\n\n"
        context += "```json\n{\n"
        context += '  "$schema": "../../schemas/skill-schemas/skill.json",\n'
        context += '  "name": "Video Translator",\n'
        context += '  "bridge": "nodejs",\n'
        context += '  "version": "1.0.0",\n'
        context += (
            '  "description": "Translate and dub videos into different languages.",\n'
        )
        context += '  "author": {\n'
        context += '    "name": "Your Name",\n'
        context += '    "email": "your.email@example.com"\n'
        context += "  },\n"
        context += '  "flow": [\n'
        context += '    "download_video",\n'
        context += '    "extract_audio",\n'
        context += '    "transcribe",\n'
        context += '    "translate_transcription",\n'
        context += '    "create_new_audio",\n'
        context += '    "merge_audio"\n'
        context += "  ],\n"
        context += '  "actions": {\n'
        context += '    "download_video": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Download a video from a URL for translation processing.",\n'
        context += '      "parameters": {\n'
        context += '        "video_url": {\n'
        context += '          "type": "string",\n'
        context += '          "description": "The URL of the video to download (YouTube, Twitch, etc.)."\n'
        context += "        },\n"
        context += '        "target_language": {\n'
        context += '          "type": "string",\n'
        context += '          "description": "The target language for translation (e.g., Chinese, Spanish, French)."\n'
        context += "        },\n"
        context += '        "quality": {\n'
        context += '          "type": "string",\n'
        context += '          "enum": ["worst", "best", "720p", "1080p", "480p"],\n'
        context += '          "description": "The video quality to download."\n'
        context += "        }\n"
        context += "      },\n"
        context += '      "optional_parameters": ["quality"]\n'
        context += "    },\n"
        context += '    "extract_audio": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Extract audio from a downloaded video file for translation processing."\n'
        context += "    },\n"
        context += '    "transcribe": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Transcribe the extracted audio to text with speaker diarization."\n'
        context += "    },\n"
        context += '    "translate_transcription": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Translate transcription from source to target language using LLM."\n'
        context += "    },\n"
        context += '    "create_new_audio": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Generate dubbed audio using voice cloning and translated text."\n'
        context += "    },\n"
        context += '    "merge_audio": {\n'
        context += '      "type": "logic",\n'
        context += '      "description": "Replace original video audio with the dubbed audio."\n'
        context += "    }\n"
        context += "  },\n"
        context += '  "action_notes": [\n'
        context += '    "The flow automatically passes data between actions using context_data.",\n'
        context += '    "Only the first action (download_video) receives direct user parameters."\n'
        context += "  ]\n"
        context += "}\n```\n\n"

        context += "## Key Differences\n\n"
        context += "### Simple Skill (No Flow):\n"
        context += '- Has only `"actions"` object\n'
        context += "- Each action can be called independently by the LLM\n"
        context += "- LLM matches user intent to action descriptions\n"
        context += "- Actions don't depend on each other\n\n"

        context += "### Complex Skill (With Flow):\n"
        context += '- Has `"flow"` array defining action execution order\n'
        context += "- Only the FIRST action in the flow is exposed to the LLM\n"
        context += "- Subsequent actions are triggered automatically in sequence\n"
        context += "- Data passes between actions via `leon.answer({ 'core': { 'context_data': {...} } })`\n"
        context += '- Can reference actions from other skills (e.g., `"music_audio_toolkit_skill:transcribe_audio"`)\n\n'

        context += "## Required Fields (Per Schema)\n\n"
        context += "**Skill Level (Required):**\n"
        context += '- `$schema`: "../../schemas/skill-schemas/skill.json"\n'
        context += "- `name`: Skill name (string, min 1 char)\n"
        context += '- `bridge`: "nodejs" or "python"\n'
        context += '- `version`: Semver string (e.g., "1.0.0")\n'
        context += "- `description`: What the skill does (string, min 1 char)\n"
        context += (
            "- `author`: Object with `name` (required), optional `email` and `url`\n"
        )
        context += "- `actions`: Object containing action definitions\n\n"

        context += "**Optional Skill Fields:**\n"
        context += "- `flow`: Array of action names to execute in sequence\n"
        context += "- `action_notes`: Array of strings for additional LLM context\n\n"

        context += "**Action Fields:**\n"
        context += (
            '- `type` (required): "logic" (runs code) or "dialog" (just responds)\n'
        )
        context += "- `description` (required): 16-128 chars, used by LLM to match user intent\n"
        context += "- `parameters` (optional): Object defining expected inputs\n"
        context += "- `optional_parameters` (optional): Array of parameter names that are optional\n"
        context += "- `is_loop` (optional): Boolean for action loops\n\n"

        context += "## Parameter Definition Format\n\n"
        context += "Parameters support various types:\n\n"
        context += "```json\n"
        context += '"parameters": {\n'
        context += '  "param_name": {\n'
        context += '    "type": "string",  // or "number"\n'
        context += (
            '    "description": "What this parameter represents (8-128 chars).",\n'
        )
        context += '    "enum": ["option1", "option2"]  // Optional: restrict to specific values\n'
        context += "  },\n"
        context += '  "complex_param": {\n'
        context += '    "type": "object",\n'
        context += '    "properties": {\n'
        context += '      "nested_field": { "type": "string" }\n'
        context += "    },\n"
        context += '    "description": "Object with nested properties."\n'
        context += "  }\n"
        context += "}\n```\n\n"

        context += "## Decision Guide: Flow or No Flow?\n\n"
        context += "Ask yourself:\n"
        context += (
            "1. **Does my skill have multiple actions that must run in sequence?**\n"
        )
        context += "   - YES → Use a `flow` array\n"
        context += "   - NO → Use direct actions only\n\n"
        context += "2. **Do my actions need to pass data to each other?**\n"
        context += "   - YES → Use a `flow` with `context_data`\n"
        context += "   - NO → Use direct actions\n\n"
        context += "3. **Is there a clear step-by-step pipeline?**\n"
        context += "   - YES → Use a `flow`\n"
        context += "   - NO → Use direct actions\n\n"

        context += "## CRITICAL: Toolkit Skills - Reusable Actions Across Skills\n\n"
        context += "**IMPORTANT**: Some skills are designed as **toolkit skills** - their actions can be reused by other skills!\n\n"

        context += "### What Are Toolkit Skills?\n\n"
        context += "Toolkit skills are special skills whose primary purpose is to provide **reusable actions** that other skills can call.\n"
        context += "They typically end with `_toolkit_skill` in their name.\n\n"

        context += "**Existing Toolkit Skills:**\n"
        context += "- `music_audio_toolkit_skill`: Provides actions like `transcribe_audio`, `detect_language`, etc.\n"
        context += "- `search_web_toolkit_skill`: Provides `search` action for web/X research\n"
        context += "- More toolkit skills may exist in the skills directory\n\n"

        context += "### How to Use Toolkit Skills in Flows\n\n"
        context += '**Format**: `"skill_name:action_name"`\n\n'

        context += "**Example: Using music_audio_toolkit_skill in a flow**\n"
        context += "```json\n"
        context += "{\n"
        context += '  "flow": [\n'
        context += '    "download_video",\n'
        context += '    "extract_audio",\n'
        context += '    "music_audio_toolkit_skill:transcribe_audio",\n'
        context += '    "translate_transcription"\n'
        context += "  ],\n"
        context += '  "actions": {\n'
        context += '    "download_video": { "type": "logic", "description": "..." },\n'
        context += '    "extract_audio": { "type": "logic", "description": "..." },\n'
        context += (
            "    // No need to define transcribe_audio - it comes from the toolkit!\n"
        )
        context += (
            '    "translate_transcription": { "type": "logic", "description": "..." }\n'
        )
        context += "  }\n"
        context += "}\n"
        context += "```\n\n"

        context += "### When to Use Toolkit Skills\n\n"
        context += "**USE toolkit skill actions when:**\n"
        context += (
            "- ✅ The functionality already exists (transcription, search, etc.)\n"
        )
        context += "- ✅ You want consistent behavior across multiple skills\n"
        context += "- ✅ You want to avoid code duplication\n\n"

        context += "**CREATE your own action when:**\n"
        context += "- ✅ You need custom logic specific to your skill\n"
        context += "- ✅ No toolkit skill provides the needed functionality\n\n"

        context += "### Finding Available Toolkit Actions\n\n"
        context += (
            "**IMPORTANT**: Before creating a skill, check existing toolkit skills:\n"
        )
        context += "1. Read `skills/*_toolkit_skill/skill.json` files\n"
        context += "2. Check their README.md for usage examples\n"
        context += "3. Look at their `actions` object for available actions\n\n"

        context += "## Best Practices\n\n"
        context += (
            "1. **Start simple**: If you only need one action, don't use a flow\n"
        )
        context += "2. **Check toolkit skills FIRST**: Don't reinvent the wheel - use existing toolkit actions\n"
        context += "3. **Use flows for pipelines**: Video processing, translation, multi-step tasks\n"
        context += "4. **Descriptive action descriptions**: LLM uses them to match user intent (16-128 chars)\n"
        context += "5. **Descriptive action names**: Use verbs (download_video, transcribe, translate)\n"
        context += "6. **First action gets parameters**: Only the first action in a flow receives user parameters\n"
        context += "7. **Use context_data**: Pass data between flow actions via `leon.answer({ 'core': { 'context_data': {...} } })`\n"
        context += (
            "8. **Schema validation**: Always include `$schema` reference at the top\n"
        )
        context += '9. **Cross-skill format**: Use `"skill_name:action_name"` for toolkit actions in flows\n'
        context += "10. **Read toolkit READMEs**: They contain usage examples and parameter requirements\n\n"

        context += "### locales/en.json - CRITICAL STRUCTURE\n"
        context += "**VERY IMPORTANT**: The locale file has a specific structure with top-level properties.\n"
        context += "DO NOT put action names directly at the root level!\n\n"
        context += "```json\n"
        context += "{\n"
        context += (
            '  "$schema": "../../../schemas/skill-schemas/skill-locale-config.json",\n'
        )
        context += '  "actions": {\n'
        context += '    "action_name_1": {\n'
        context += '      "missing_param_follow_ups": {\n'
        context += (
            '        "param_name": ["Follow up question 1", "Follow up question 2"]\n'
        )
        context += "      },\n"
        context += '      "answers": {\n'
        context += (
            '        "answer_key": ["Answer variation 1", "Answer variation 2"]\n'
        )
        context += "      }\n"
        context += "    },\n"
        context += '    "action_name_2": {\n'
        context += "      // Same structure\n"
        context += "    }\n"
        context += "  },\n"
        context += '  "common_answers": {\n'
        context += '    "common_key": ["Shared answer 1", "Shared answer 2"]\n'
        context += "  },\n"
        context += '  "variables": {\n'
        context += '    "var_name": "value"\n'
        context += "  },\n"
        context += '  "widget_contents": {\n'
        context += '    "widget_key": "Widget content"\n'
        context += "  }\n"
        context += "}\n"
        context += "```\n\n"

        context += "**Locale File Structure Rules:**\n"
        context += "1. Must have `$schema` reference at the top\n"
        context += (
            "2. Must have `actions` object containing all action configurations\n"
        )
        context += "3. Can have optional `common_answers` for shared responses\n"
        context += "4. Can have optional `variables` for reusable values\n"
        context += "5. Can have optional `widget_contents` for widget text\n"
        context += "6. Each action inside `actions` has `missing_param_follow_ups` and `answers`\n\n"

        # Add settings files documentation
        context += "# Skill Settings Files - REQUIRED\n\n"
        context += "**CRITICAL**: Every skill MUST have both settings files, even if empty.\n\n"

        context += "## Required Files\n\n"
        context += "1. **src/settings.sample.json** - Sample configuration template\n"
        context += "2. **src/settings.json** - Actual configuration (initially identical to sample)\n\n"

        context += "Both files must be **identical** when created. Users will modify settings.json with their values.\n\n"

        context += "## Settings File Patterns\n\n"

        context += "### Pattern 1: No Configuration Needed\n\n"
        context += "If the skill doesn't need any API keys or configuration:\n\n"
        context += "```json\n"
        context += "{}\n"
        context += "```\n\n"

        context += "### Pattern 2: API Keys and Configuration\n\n"
        context += (
            "If the skill needs API keys, provider selection, or other settings:\n\n"
        )
        context += "```json\n"
        context += "{\n"
        context += '  "provider_api_key": "sk-...",\n'
        context += '  "provider_model": "model-name",\n'
        context += '  "max_tokens": 2000,\n'
        context += '  "temperature": 0.7\n'
        context += "}\n"
        context += "```\n\n"

        context += "## Real Examples\n\n"

        context += "### Example 1: Simple Skill (No Settings)\n"
        context += "```json\n"
        context += "// src/settings.sample.json and src/settings.json\n"
        context += "{}\n"
        context += "```\n\n"

        context += "### Example 2: Skill with API Configuration\n"
        context += "```json\n"
        context += "// src/settings.sample.json and src/settings.json\n"
        context += "{\n"
        context += '  "translation_openrouter_api_key": "",\n'
        context += (
            '  "translation_openrouter_model": "google/gemini-3-flash-preview",\n'
        )
        context += '  "translation_max_tokens_per_request": 2000,\n'
        context += '  "translation_segments_per_batch": 10,\n'
        context += '  "speech_synthesis_provider": "chatterbox_onnx"\n'
        context += "}\n"
        context += "```\n\n"

        context += "## How to Use Settings in Actions\n\n"

        if bridge == "nodejs":
            context += "```typescript\n"
            context += "import { Settings } from '@sdk/settings'\n"
            context += "import ToolManager, { isMissingToolSettingsError } from '@sdk/tool-manager'\n"
            context += "import OpenRouterTool from '@tools/communication/openrouter'\n\n"
            context += "interface MySkillSettings extends Record<string, unknown> {\n"
            context += "  provider_model?: string\n"
            context += "  max_tokens?: number\n"
            context += "}\n\n"
            context += "export const run: ActionFunction = async function (params, paramsHelper) {\n"
            context += "  const settings = new Settings<MySkillSettings>()\n"
            context += "  const model = (await settings.get('provider_model')) || 'default-model'\n"
            context += (
                "  const maxTokens = (await settings.get('max_tokens')) || 1000\n\n"
            )
            context += "  let tool: OpenRouterTool\n"
            context += "  try {\n"
            context += "    tool = await ToolManager.initTool(OpenRouterTool)\n"
            context += "  } catch (error) {\n"
            context += "    if (isMissingToolSettingsError(error)) return\n"
            context += "    throw error\n"
            context += "  }\n\n"
            context += "  // Use tool + settings...\n"
            context += "}\n"
            context += "```\n\n"
        else:
            context += "```python\n"
            context += "from bridges.python.src.sdk.tool_manager import ToolManager, is_missing_tool_settings_error\n"
            context += "from bridges.python.src.sdk.types import ActionParams\n"
            context += "from bridges.python.src.sdk.settings import Settings\n"
            context += "from tools.communication.openrouter import OpenRouterTool\n\n"
            context += (
                "def run(params: ActionParams, params_helper: ParamsHelper) -> None:\n"
            )
            context += "    settings = Settings()\n"
            context += "    model = settings.get('provider_model') or 'default-model'\n"
            context += "    max_tokens = settings.get('max_tokens') or 1000\n\n"
            context += "    try:\n"
            context += "        tool = ToolManager.init_tool(OpenRouterTool)\n"
            context += "    except Exception as error:\n"
            context += "        if is_missing_tool_settings_error(error):\n"
            context += "            return\n"
            context += "        raise\n\n"
            context += "    # Use tool + settings...\n"
            context += "    # On errors, include: core: { 'should_stop_skill': True }\n"
            context += "```\n\n"

        context += "## Settings Best Practices\n\n"
        context += "1. **Always create both files**: settings.sample.json AND settings.json (identical initially)\n"
        context += "2. **Use descriptive keys**: `translation_api_key` not `key1`\n"
        context += "3. **Provide placeholder values**: Show the format. But set null for API keys or credentials\n"
        context += "4. **Include defaults**: For non-sensitive settings (model names, timeouts, etc.)\n"
        context += "5. **Document in README**: Explain what each setting does\n"
        context += "6. **Validate in action**: Check if required settings exist before using them\n"
        context += "7. **Use empty object if no settings**: Don't skip the files, create `{}`\n\n"

        # Add CRITICAL planning section
        context += (
            "# CRITICAL: Planning and Understanding Tools BEFORE Writing Code\n\n"
        )
        context += "**EXTREMELY IMPORTANT**: You MUST follow this workflow before writing ANY code:\n\n"

        context += "## Step 1: Identify Required Tools\n\n"
        context += "Before writing code, analyze what tools you'll need:\n"
        context += "1. **Review the available tools list above** - Check if tools already exist\n"
        context += "2. **Match your needs to existing tools** - Don't duplicate functionality\n"
        context += "3. **List the tools you plan to use** - Be specific (e.g., FfmpegTool, ChatterboxOnnxTool)\n\n"

        context += "## Step 2: Read and Understand Tool Implementations\n\n"
        context += "**CRITICAL**: You MUST read the actual source code of tools before using them!\n\n"
        file_ext = ".ts" if bridge == "nodejs" else ".py"
        context += f"For EACH tool you plan to use:\n"
        context += f"1. **Read the tool source** under `tools/{{toolkit-name}}/{{tool-name}}/src/{bridge}/{{tool-name}}-tool{file_ext}`\n"
        context += (
            "2. **Understand ALL available methods** - Don't assume, READ the code\n"
        )
        context += "3. **Check for batch/efficient operations** - Many tools support batch processing!\n"
        context += "4. **Note the method signatures** - Parameter names, types, return values\n"
        context += "5. **Look for special features** - Async operations, streaming, callbacks, etc.\n\n"

        context += "## Step 3: Plan for Efficiency\n\n"
        context += "**CRITICAL EXAMPLES OF EFFICIENT PATTERNS:**\n\n"

        context += "### Example: ChatterboxOnnxTool - Batch Processing\n\n"
        context += "❌ **WRONG** - Multiple separate calls (SLOW):\n"
        if bridge == "nodejs":
            context += "```typescript\n"
            context += "// DON'T DO THIS - Inefficient!\n"
            context += "for (const segment of segments) {\n"
            context += "  await chatterbox.synthesizeSpeechToFiles({\n"
            context += "    text: segment.text,\n"
            context += "    audio_path: segment.path\n"
            context += "  })\n"
            context += "}\n"
            context += "```\n\n"

            context += "✅ **CORRECT** - Single batch call (FAST):\n"
            context += "```typescript\n"
            context += "// DO THIS - Read the tool to discover it accepts an array!\n"
            context += "const tasks = segments.map(segment => ({\n"
            context += "  text: segment.text,\n"
            context += "  audio_path: segment.path,\n"
            context += "  voice_name: segment.voice\n"
            context += "}))\n\n"
            context += "// Single call processes all segments efficiently\n"
            context += "await chatterbox.synthesizeSpeechToFiles(tasks)\n"
            context += "```\n\n"
        else:
            context += "```python\n"
            context += "# DON'T DO THIS - Inefficient!\n"
            context += "for segment in segments:\n"
            context += "    chatterbox.synthesize_speech_to_files({\n"
            context += "        'text': segment['text'],\n"
            context += "        'audio_path': segment['path']\n"
            context += "    })\n"
            context += "```\n\n"

            context += "✅ **CORRECT** - Single batch call (FAST):\n"
            context += "```python\n"
            context += "# DO THIS - Read the tool to discover it accepts a list!\n"
            context += "tasks = [{\n"
            context += "    'text': segment['text'],\n"
            context += "    'audio_path': segment['path'],\n"
            context += "    'voice_name': segment['voice']\n"
            context += "} for segment in segments]\n\n"
            context += "# Single call processes all segments efficiently\n"
            context += "chatterbox.synthesize_speech_to_files(tasks)\n"
            context += "```\n\n"

        context += "### Why This Matters:\n\n"
        context += "- **Performance**: Batch processing can be 10-100x faster\n"
        context += "- **Resource efficiency**: Less overhead, better parallelization\n"
        context += "- **Better UX**: User gets results much faster\n\n"

        context += "## Step 4: Plan Your Architecture\n\n"
        context += "Now that you understand the tools, plan your code:\n"
        context += "1. **Outline the workflow** - Step-by-step what needs to happen\n"
        context += (
            "2. **Identify batch opportunities** - Where can you group operations?\n"
        )
        context += "3. **Plan data structures** - What format does each tool expect?\n"
        context += "4. **Consider error handling** - What if a tool call fails?\n"
        context += "5. **Think about progress reporting** - Keep user informed\n\n"

        context += "## Step 5: Only THEN Write Code\n\n"
        context += (
            "After completing steps 1-4, you can write efficient, correct code.\n\n"
        )

        context += "## If Tools or Methods Are Missing\n\n"
        context += "If you've read the tools and found:\n"
        context += (
            "- **Tool doesn't exist**: Create a new tool (see guidelines below)\n"
        )
        context += "- **Method is missing**: Add the method to the existing tool (in BOTH TS + Python)\n"
        context += "- **Functionality is incomplete**: Extend the tool with new capabilities\n\n"

        context += "**REMEMBER**: Always implement in BOTH TypeScript AND Python when creating/extending tools!\n\n"

        # Add new tool creation and extension documentation
        context += self._get_tool_creation_guidelines(bridge)

        # Add Aurora UI components documentation
        context += self._scan_aurora_components()

        context += "# Understanding leon.answer() - Critical Information\n\n"
        context += "The `leon.answer()` method is your primary way to communicate with users and pass data between actions.\n\n"
        context += "## Basic Usage\n\n"

        if bridge == "nodejs":
            context += "```typescript\n"
            context += "// Simple text response with localized message key\n"
            context += "leon.answer({\n"
            context += "  key: 'success_message',\n"
            context += "  data: {\n"
            context += "    file_name: 'example.mp4',\n"
            context += "    file_size: '25 MB'\n"
            context += "  }\n"
            context += "})\n"
            context += "```\n\n"
        else:
            context += "```python\n"
            context += "# Simple text response with localized message key\n"
            context += "leon.answer({\n"
            context += "  'key': 'success_message',\n"
            context += "  'data': {\n"
            context += "    'file_name': 'example.mp4',\n"
            context += "    'file_size': '25 MB'\n"
            context += "  }\n"
            context += "})\n"
            context += "```\n\n"

        context += "## Passing Data to Next Action (context_data)\n\n"
        context += "Use `core.context_data` to pass data between actions in a multi-step workflow:\n\n"

        if bridge == "nodejs":
            context += "```typescript\n"
            context += "// Action 1: Download video and pass path to next action\n"
            context += "leon.answer({\n"
            context += "  key: 'download_completed',\n"
            context += "  data: {\n"
            context += "    file_path: formatFilePath(videoPath)\n"
            context += "  },\n"
            context += "  core: {\n"
            context += "    context_data: {\n"
            context += "      video_path: videoPath,           // Pass full path\n"
            context += (
                "      target_language: targetLanguage, // Pass other needed data\n"
            )
            context += "      quality: quality\n"
            context += "    }\n"
            context += "  }\n"
            context += "})\n\n"
            context += "// Action 2: Retrieve data from previous action\n"
            context += (
                "const videoPath = paramsHelper.getContextData<string>('video_path')\n"
            )
            context += "const targetLanguage = paramsHelper.getContextData<string>('target_language')\n"
            context += "```\n\n"
        else:
            context += "```python\n"
            context += "# Action 1: Download video and pass path to next action\n"
            context += "leon.answer({\n"
            context += "  'key': 'download_completed',\n"
            context += "  'data': {\n"
            context += "    'file_path': format_file_path(video_path)\n"
            context += "  },\n"
            context += "  'core': {\n"
            context += "    'context_data': {\n"
            context += "      'video_path': video_path,           # Pass full path\n"
            context += (
                "      'target_language': target_language, # Pass other needed data\n"
            )
            context += "      'quality': quality\n"
            context += "    }\n"
            context += "  }\n"
            context += "})\n\n"
            context += "# Action 2: Retrieve data from previous action\n"
            context += "video_path = params_helper.get_context_data('video_path')\n"
            context += (
                "target_language = params_helper.get_context_data('target_language')\n"
            )
            context += "```\n\n"

        context += "## Widget Usage\n\n"
        context += "**Show**: `leon.answer({ widget: myWidget })` (no key/data!)\n"
        context += "**Update**: Use `replaceMessageId` and keep same widget ID\n\n"

        context += "## leon.answer() Options\n\n"
        context += "- **key**: Localized message key\n"
        context += "- **data**: Variables for message (user-visible)\n"
        context += "- **widget**: UI component (MUST be alone, no key/data!)\n"
        context += "- **core.context_data**: Data for next action\n"
        context += "- **core.next_action**: Chain to 'skill:action'\n"
        context += "- **replaceMessageId**: Update existing message\n\n"

        if context_files:
            context += "# Reference Files\n\n"
            context += "Please study these example files:\n"
            for file in context_files:
                context += f"- {file}\n"
            context += "\n"

        return context

    def generate_skill(
        self,
        description: str,
        provider: str,
        target_path: str,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        context_files: Optional[List[str]] = None,
        system_prompt: Optional[str] = None,
        bridge: str = "nodejs",
    ) -> Dict[str, Any]:
        """
        Generate skill using OpenCode CLI with agentic loop

        Args:
            description: Description of the skill to generate
            provider: LLM provider to use
            target_path: Target directory for generated skill
            model: Model name (uses default if not specified)
            api_key: API key for the provider
            context_files: List of files for OpenCode to learn from
            system_prompt: System prompt for the LLM

        Returns:
            Dict with result or error
        """
        # Get provider configuration
        provider_data = self.providers.get(provider)

        # If not configured, configure with provided API key
        if not provider_data and api_key:
            provider_config = self.provider_configs[provider]
            model_to_use = model or provider_config["default_model"]

            self.configure_provider(provider, api_key, model_to_use)
            provider_data = self.providers.get(provider)

            # Setup OpenCode auth
            self._setup_provider_auth(provider, api_key)

        if not provider_data or not provider_data.get("api_key"):
            return {
                "success": False,
                "error": f"Provider '{provider}' is not configured. Please provide an API key.",
            }

        model_to_use = provider_data.get("model")

        # Build the OpenCode prompt with Leon-specific context
        leon_context = self._build_leon_context(
            description, system_prompt, context_files or [], bridge
        )
        full_prompt = f"{leon_context}\n\n{description}"

        # Create temporary prompt file
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, prefix="opencode-leon-"
        ) as tmp:
            tmp.write(full_prompt)
            prompt_file = tmp.name

        os.makedirs(target_path, exist_ok=True)

        try:
            skills_dir = Path(target_path) / "skills"
            existing_skills = self._get_existing_skills(skills_dir)

            args = ["run", description]
            if model_to_use:
                args.extend(["--model", model_to_use])
            args.extend(["--file", prompt_file])

            result = self.execute_command(
                ExecuteCommandOptions(
                    binary_name="opencode",
                    args=args,
                    options={
                        "sync": True,
                        "cwd": target_path,
                        "timeout": 600_000,
                        "open_in_terminal": True,
                    },
                )
            )

            files_created = self._get_created_files(skills_dir, existing_skills)

            return {
                "success": True,
                "output": result
                or f"OpenCode launched in a new terminal. Prompt: {prompt_file}",
                "provider_used": provider,
                "model_used": model_to_use,
                "files_created": files_created,
            }

        except Exception as e:
            return {"success": False, "error": f"OpenCode generation error: {str(e)}"}

    def _get_existing_skills(self, skills_dir: Path) -> set:
        """Get set of existing skill folder names"""
        existing = set()
        try:
            if skills_dir.exists():
                for entry in skills_dir.iterdir():
                    if entry.is_dir() and entry.name.endswith("_skill"):
                        existing.add(entry.name)
        except Exception:
            pass
        return existing

    def _get_created_files(self, skills_dir: Path, existing_skills: set) -> List[str]:
        """Get list of newly created files in new skill folders"""
        created_files = []
        try:
            if skills_dir.exists():
                for entry in skills_dir.iterdir():
                    if (
                        entry.is_dir()
                        and entry.name.endswith("_skill")
                        and entry.name not in existing_skills
                    ):
                        all_files = self._get_all_files_recursive(entry)
                        created_files.extend(
                            [str(f.relative_to(Path.cwd())) for f in all_files]
                        )
        except Exception:
            pass
        return created_files

    def _get_all_files_recursive(self, dir_path: Path) -> List[Path]:
        """Recursively get all files in a directory"""
        files = []
        try:
            for entry in dir_path.iterdir():
                if entry.is_dir():
                    files.extend(self._get_all_files_recursive(entry))
                else:
                    files.append(entry)
        except Exception:
            pass
        return files
