import json
from typing import Dict, Any, Optional, List

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig
from bridges.python.src.sdk.network import Network, NetworkError

# Hardcoded default settings for Cerebras tool
CEREBRAS_API_KEY = None
CEREBRAS_MODEL = "zai-glm-4.7"
DEFAULT_SETTINGS = {
    "CEREBRAS_API_KEY": CEREBRAS_API_KEY,
    "CEREBRAS_MODEL": CEREBRAS_MODEL,
}
REQUIRED_SETTINGS = ["CEREBRAS_API_KEY"]


class CerebrasTool(BaseTool):
    """Cerebras tool for LLM API access (e.g., GLM 4.7)"""

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
            "CEREBRAS_API_KEY", CEREBRAS_API_KEY
        )

        # Load model settings
        self.model = self.settings.get("CEREBRAS_MODEL", CEREBRAS_MODEL)

        self.network = Network({"base_url": "https://api.cerebras.ai/v1"})

        # Popular Cerebras-hosted models (override with full model IDs if needed)
        self.popular_models = {
            "zai-glm-4.7": "zai-glm-4.7",
            "qwen-3-235b-a22b-instruct-2507": "qwen-3-235b-a22b-instruct-2507",
            "qwen-3-32b": "qwen-3-32b",
        }

    @property
    def tool_name(self) -> str:
        return "cerebras"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config["description"]

    def set_api_key(self, api_key: str) -> None:
        """Set the Cerebras API key"""
        self.api_key = api_key

    def get_available_models(self) -> List[str]:
        """Get list of popular available models"""
        return list(self.popular_models.keys())

    def get_model_id(self, model_name: str) -> str:
        """Convert friendly model name to Cerebras model ID"""
        return self.popular_models.get(model_name, model_name)

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
        Send a chat completion request to Cerebras

        Args:
            messages: List of message dictionaries with 'role' and 'content'
            model: Model name (friendly name or full model ID)
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            system_prompt: System prompt to prepend
            use_structured_output: Whether to use structured outputs
            json_schema: JSON schema for structured output (required if use_structured_output=True)

        Returns:
            Dict with response data or error information
        """
        if not self.api_key:
            return {"success": False, "error": "Cerebras API key not configured"}

        # Use default model if none provided
        model = model or self.model

        model_id = self.get_model_id(model)

        request_messages: List[Dict[str, str]] = []
        if system_prompt:
            request_messages.append({"role": "system", "content": system_prompt})
        request_messages.extend(messages)

        payload: Dict[str, Any] = {
            "model": model_id,
            "messages": request_messages,
            "temperature": temperature,
        }

        if max_tokens:
            payload["max_tokens"] = max_tokens

        if use_structured_output:
            payload["response_format"] = {"type": "json_object"}
            if json_schema:
                schema_text = json.dumps(json_schema)
                schema_prompt = (
                    "You must return a valid JSON object that matches this schema:\n"
                    f"{schema_text}"
                )
                payload["messages"] = [
                    {"role": "system", "content": schema_prompt}
                ] + request_messages

        try:
            response = self.network.request(
                {
                    "url": "/chat/completions",
                    "method": "POST",
                    "headers": {
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    "data": payload,
                }
            )

            return {"success": True, "data": response["data"], "model_used": model_id}

        except NetworkError as e:
            return {
                "success": False,
                "error": f"Cerebras API error: {str(e)}",
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
            model: LLM model to use
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
        Generate structured JSON output using Cerebras structured outputs

        Args:
            prompt: Text prompt to complete
            json_schema: JSON schema defining the required output structure
            model: LLM model to use
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
        Get list of available models from Cerebras API

        Returns:
            Dict with models list or error
        """
        if not self.api_key:
            return {"success": False, "error": "Cerebras API key not configured"}

        try:
            response = self.network.request(
                {
                    "url": "/models",
                    "method": "GET",
                    "headers": {"Authorization": f"Bearer {self.api_key}"},
                }
            )

            return {
                "success": True,
                "models": response["data"].get("data", response["data"]),
            }
        except NetworkError as e:
            return {"success": False, "error": f"Failed to fetch models: {str(e)}"}
