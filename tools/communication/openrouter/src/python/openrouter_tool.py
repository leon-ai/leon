import json
from typing import Dict, Any, Optional, List
from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network, NetworkError

# Hardcoded default settings for OpenRouter tool
OPENROUTER_API_KEY = None
OPENROUTER_MODEL = "google/gemini-3-flash-preview"
DEFAULT_SETTINGS = {
    "OPENROUTER_API_KEY": OPENROUTER_API_KEY,
    "OPENROUTER_MODEL": OPENROUTER_MODEL,
}
REQUIRED_SETTINGS = ["OPENROUTER_API_KEY"]


class OpenRouterTool(BaseTool):
    """OpenRouter tool for unified LLM API access across all skills"""

    TOOLKIT = "communication"

    def __init__(self, api_key: Optional[str] = None):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

        tool_settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.settings = tool_settings
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

        # Priority: skill-provided api_key > toolkit settings > hardcoded default
        self.api_key = api_key or self.settings.get(
            "OPENROUTER_API_KEY", OPENROUTER_API_KEY
        )

        # Load model settings
        self.model = self.settings.get("OPENROUTER_MODEL", OPENROUTER_MODEL)

        self.network = Network({"base_url": "https://openrouter.ai/api"})

    @property
    def tool_name(self) -> str:
        return "openrouter"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def set_api_key(self, api_key: str) -> None:
        """Set the OpenRouter API key"""
        self.api_key = api_key

    def chat_completion(
        self,
        messages: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        use_structured_output: bool = False,
        json_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Send a chat completion request to OpenRouter

        Args:
            messages: List of message dictionaries with 'role' and 'content'
            model: Model ID (full OpenRouter model ID, e.g. 'google/gemini-3-flash-preview')
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            system_prompt: System prompt to prepend
            use_structured_output: Whether to use OpenRouter's structured outputs
            json_schema: JSON schema for structured output (required if use_structured_output=True)

        Returns:
            Dict with response data or error information
        """
        if not self.api_key:
            return {"success": False, "error": "OpenRouter API key not configured"}

        # Use default model if none provided
        model = model or self.model

        # Prepare messages with system prompt if provided
        request_messages = []
        if system_prompt:
            request_messages.append({"role": "system", "content": system_prompt})
        request_messages.extend(messages)

        # Prepare request payload
        payload = {
            "model": model,
            "messages": request_messages,
            "temperature": temperature,
        }

        if max_tokens:
            payload["max_tokens"] = max_tokens

        # Add structured output configuration if requested
        if use_structured_output and json_schema:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": json_schema.get("name", "response"),
                    "strict": True,
                    "schema": json_schema["schema"],
                },
            }

        try:
            response = self.network.request(
                {
                    "url": "/v1/chat/completions",
                    "method": "POST",
                    "headers": {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    "data": payload,
                }
            )

            return {"success": True, "data": response["data"], "model_used": model}

        except NetworkError as e:
            return {
                "success": False,
                "error": f"OpenRouter API error: {str(e)}",
                "status_code": getattr(e.response, "status_code", None),
            }

    def completion(
        self,
        prompt: str,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        use_structured_output: bool = False,
        json_schema: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        General text completion for any use case

        Args:
            prompt: Text prompt to complete
            model: Model ID (full OpenRouter model ID)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            system_prompt: Optional system prompt
            use_structured_output: Whether to use structured outputs
            json_schema: JSON schema for structured output

        Returns:
            Dict with completion result
        """
        messages = [{"role": "user", "content": prompt}]

        response = self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
            use_structured_output=use_structured_output,
            json_schema=json_schema,
        )

        if not response["success"]:
            return response

        try:
            content = response["data"]["choices"][0]["message"]["content"]
            return {
                "success": True,
                "content": content,
                "model_used": response["model_used"],
            }
        except (KeyError, IndexError) as e:
            return {
                "success": False,
                "error": f"Failed to extract completion: {str(e)}",
            }

    def structured_completion(
        self,
        prompt: str,
        json_schema: Dict[str, Any],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generate structured JSON output using OpenRouter's structured outputs feature

        Args:
            prompt: Text prompt to complete
            json_schema: JSON schema defining the required output structure
            model: Model ID (full OpenRouter model ID)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate
            system_prompt: Optional system prompt

        Returns:
            Dict with parsed JSON result or error
        """
        messages = [{"role": "user", "content": prompt}]

        response = self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
            use_structured_output=True,
            json_schema=json_schema,
        )

        if not response["success"]:
            return response

        try:
            content = response["data"]["choices"][0]["message"]["content"]
            # With structured outputs, content is already valid JSON
            parsed_data = json.loads(content)
            return {
                "success": True,
                "data": parsed_data,
                "model_used": response["model_used"],
            }
        except (KeyError, IndexError) as e:
            return {
                "success": False,
                "error": f"Failed to extract completion: {str(e)}",
            }
        except json.JSONDecodeError as e:
            return {
                "success": False,
                "error": f"Failed to parse JSON response: {str(e)}",
            }

    def list_models(self) -> Dict[str, Any]:
        """
        Get list of available models from OpenRouter API

        Returns:
            Dict with models list or error
        """
        if not self.api_key:
            return {"success": False, "error": "OpenRouter API key not configured"}

        try:
            response = self.network.request(
                {
                    "url": "/v1/models",
                    "method": "GET",
                    "headers": {"Authorization": f"Bearer {self.api_key}"},
                }
            )

            return {"success": True, "models": response["data"]["data"]}

        except NetworkError as e:
            return {"success": False, "error": f"Failed to fetch models: {str(e)}"}
