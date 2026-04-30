import os
from typing import Any, Dict, Optional, Literal

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.network import Network
from bridges.python.src.sdk.toolkit_config import ToolkitConfig


class InferenceTool(BaseTool):
    TOOLKIT = "communication"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)
        self.network = Network(
            {
                "base_url": f"{os.environ.get('LEON_HOST')}:{os.environ.get('LEON_PORT')}/api/v1"
            }
        )

    @property
    def tool_name(self) -> str:
        return "inference"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config.get("description", "")

    def completion(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        thought_tokens_budget: Optional[int] = None,
        disable_thinking: Optional[bool] = None,
        reasoning_mode: Optional[Literal["off", "guarded", "on"]] = None,
        track_provider_errors: Optional[bool] = None,
    ) -> Dict[str, Any]:
        response = self.network.request(
            {
                "url": "/inference",
                "method": "POST",
                "data": {
                    "prompt": prompt,
                    "systemPrompt": system_prompt,
                    "temperature": temperature,
                    "maxTokens": max_tokens,
                    "thoughtTokensBudget": thought_tokens_budget,
                    "disableThinking": disable_thinking,
                    "reasoningMode": reasoning_mode,
                    "trackProviderErrors": track_provider_errors,
                },
            }
        )

        return response["data"]

    def structured_completion(
        self,
        prompt: str,
        json_schema: Dict[str, Any],
        system_prompt: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        thought_tokens_budget: Optional[int] = None,
        disable_thinking: Optional[bool] = None,
        reasoning_mode: Optional[Literal["off", "guarded", "on"]] = None,
        track_provider_errors: Optional[bool] = None,
    ) -> Dict[str, Any]:
        response = self.network.request(
            {
                "url": "/inference",
                "method": "POST",
                "data": {
                    "prompt": prompt,
                    "systemPrompt": system_prompt,
                    "temperature": temperature,
                    "maxTokens": max_tokens,
                    "thoughtTokensBudget": thought_tokens_budget,
                    "jsonSchema": json_schema,
                    "disableThinking": disable_thinking,
                    "reasoningMode": reasoning_mode,
                    "trackProviderErrors": track_provider_errors,
                },
            }
        )

        return response["data"]
