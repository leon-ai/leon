"""
xAI Grok Tool with Server-Side Agentic Search
Uses the Responses API (/v1/responses) for tool support
Reference: https://docs.x.ai/docs/guides/tools/search-tools
"""

import json
from typing import Dict, Any, List, Optional
import requests

from bridges.python.src.sdk.base_tool import BaseTool
from bridges.python.src.sdk.toolkit_config import ToolkitConfig

# Hardcoded default settings for Grok tool
GROK_API_KEY = None
GROK_MODEL = "grok-4-1-fast-reasoning"
DEFAULT_SETTINGS = {
    "GROK_API_KEY": GROK_API_KEY,
    "GROK_MODEL": GROK_MODEL,
}
REQUIRED_SETTINGS = ["GROK_API_KEY"]

class GrokTool(BaseTool):
    """
    Grok Tool for AI-powered web and X/Twitter search using xAI's server-side tools.

    Features:
    - Web search with domain filtering and image understanding
    - X/Twitter search with handle filtering, date ranges, and video understanding
    - Server-side agentic tool calling
    - Citation tracking (citations and inline_citations)
    - Deep research capabilities
    """

    TOOLKIT = "search_web"

    def __init__(self):
        super().__init__()
        self.config = ToolkitConfig.load(self.TOOLKIT, self.tool_name)

        tool_settings = ToolkitConfig.load_tool_settings(
            self.TOOLKIT, self.tool_name, DEFAULT_SETTINGS
        )
        self.settings = tool_settings
        self.required_settings = REQUIRED_SETTINGS
        self._check_required_settings(self.tool_name)

        # Priority: toolkit settings > hardcoded default
        self.api_key = self.settings.get("GROK_API_KEY", GROK_API_KEY)
        self.model = self.settings.get("GROK_MODEL", GROK_MODEL)
        self.base_url = "https://api.x.ai"

    @property
    def tool_name(self) -> str:
        return "grok"

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config.get("description", "")

    def set_api_key(self, api_key: str) -> None:
        """Set the Grok API key"""
        self.api_key = api_key

    def list_models(self) -> Dict[str, Any]:
        """
        List available models
        Reference: https://docs.x.ai/docs/api-reference
        """
        if not self.api_key:
            return {
                "success": False,
                "error": "Grok API key is not set. Please call set_api_key() first.",
            }

        try:
            response = requests.get(
                f"{self.base_url}/v1/models",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=30,
            )

            if not response.ok:
                error_data = response.json() if response.text else {}
                raise Exception(
                    f"Grok API error: {response.status_code} - {json.dumps(error_data)}"
                )

            data = response.json()

            return {"success": True, "data": data}

        except Exception as error:
            return {"success": False, "error": f"Failed to list models: {str(error)}"}

    def chat_completion(
        self,
        input: List[Dict[str, str]],
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_completion_tokens: int = 4096,
        stream: bool = False,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Perform a chat completion with Grok using server-side agentic search tools
        Uses the /v1/responses endpoint (Responses API) for tool support
        Reference: https://docs.x.ai/docs/guides/tools/search-tools
        """
        if not self.api_key:
            return {
                "success": False,
                "error": "Grok API key is not set. Please call set_api_key() first.",
            }

        # Use default model if none provided
        model = model or self.model

        try:
            request_body: Dict[str, Any] = {
                "model": model,
                "input": input,
                "temperature": temperature,
                "max_completion_tokens": max_completion_tokens,
                "stream": stream,
            }

            # Add server-side search tools if provided
            if tools and len(tools) > 0:
                request_body["tools"] = tools

            # Use /v1/responses endpoint for tools support (not /v1/chat/completions)
            response = requests.post(
                f"{self.base_url}/v1/responses",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                json=request_body,
                timeout=120,
            )

            if not response.ok:
                error_data = response.json() if response.text else {}
                raise Exception(
                    f"Grok API error: {response.status_code} - {json.dumps(error_data)}"
                )

            data = response.json()

            # Extract the final text output from the output array
            content = ""
            annotations = []
            citations = []

            if "output" in data and isinstance(data["output"], list):
                # Find the message item (type: "message")
                for item in reversed(data["output"]):
                    if item.get("type") == "message" and "content" in item:
                        content_array = item.get("content", [])
                        if isinstance(content_array, list):
                            # Find output_text in the content array
                            for content_item in content_array:
                                if content_item.get(
                                    "type"
                                ) == "output_text" and content_item.get("text"):
                                    content = content_item["text"]
                                    annotations = content_item.get("annotations", [])
                                    # Extract URLs from annotations for citations
                                    citations = [
                                        a["url"] for a in annotations if a.get("url")
                                    ]
                                    break
                        break

            return {
                "success": True,
                "data": data,
                "content": content,
                "citations": citations,
                "annotations": annotations,
            }

        except Exception as error:
            return {"success": False, "error": f"Failed to complete chat: {str(error)}"}

    def search_web(
        self,
        query: str,
        allowed_domains: Optional[List[str]] = None,
        excluded_domains: Optional[List[str]] = None,
        enable_image_understanding: bool = False,
    ) -> Dict[str, Any]:
        """
        Search the web using Grok's server-side agentic web search tool.
        The model will autonomously call the web_search tool during reasoning.
        Reference: https://docs.x.ai/docs/guides/tools/search-tools

        Args:
            query: The search query
            allowed_domains: Max 5 domains to search within
            excluded_domains: Max 5 domains to exclude
            enable_image_understanding: Enable image analysis
        """
        web_search_tool: Dict[str, Any] = {"type": "web_search"}

        if allowed_domains:
            web_search_tool["allowed_domains"] = allowed_domains
        if excluded_domains:
            web_search_tool["excluded_domains"] = excluded_domains
        if enable_image_understanding:
            web_search_tool["enable_image_understanding"] = enable_image_understanding

        return self.chat_completion(
            input=[{"role": "user", "content": query}],
            model=self.model,
            temperature=0.5,
            tools=[web_search_tool],
        )

    def search_x(
        self,
        query: str,
        allowed_x_handles: Optional[List[str]] = None,
        excluded_x_handles: Optional[List[str]] = None,
        from_date: Optional[str] = None,
        to_date: Optional[str] = None,
        enable_image_understanding: bool = False,
        enable_video_understanding: bool = False,
    ) -> Dict[str, Any]:
        """
        Search X/Twitter using Grok's server-side agentic X search tool.
        The model will autonomously call the x_search tool during reasoning.
        Reference: https://docs.x.ai/docs/guides/tools/search-tools

        Args:
            query: The search query
            allowed_x_handles: Max 10 handles to search within
            excluded_x_handles: Max 10 handles to exclude
            from_date: ISO8601 date "YYYY-MM-DD"
            to_date: ISO8601 date "YYYY-MM-DD"
            enable_image_understanding: Enable image analysis
            enable_video_understanding: Enable video analysis
        """
        x_search_tool: Dict[str, Any] = {"type": "x_search"}

        if allowed_x_handles:
            x_search_tool["allowed_x_handles"] = allowed_x_handles
        if excluded_x_handles:
            x_search_tool["excluded_x_handles"] = excluded_x_handles
        if from_date:
            x_search_tool["from_date"] = from_date
        if to_date:
            x_search_tool["to_date"] = to_date
        if enable_image_understanding:
            x_search_tool["enable_image_understanding"] = enable_image_understanding
        if enable_video_understanding:
            x_search_tool["enable_video_understanding"] = enable_video_understanding

        return self.chat_completion(
            input=[{"role": "user", "content": query}],
            model=self.model,
            temperature=0.5,
            tools=[x_search_tool],
        )

    def search(
        self,
        query: str,
        web_options: Optional[Dict[str, Any]] = None,
        x_options: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Search both web and X using both server-side search tools.
        The model will autonomously call both tools during reasoning.
        Reference: https://docs.x.ai/docs/guides/tools/search-tools

        Args:
            query: The search query
            web_options: Options for web search (allowed_domains, excluded_domains, etc.)
            x_options: Options for X search (allowed_x_handles, from_date, etc.)
        """
        tools: List[Dict[str, Any]] = []

        # Add web search tool
        web_search_tool: Dict[str, Any] = {"type": "web_search"}
        if web_options:
            web_search_tool.update(web_options)
        tools.append(web_search_tool)

        # Add X search tool
        x_search_tool: Dict[str, Any] = {"type": "x_search"}
        if x_options:
            x_search_tool.update(x_options)
        tools.append(x_search_tool)

        return self.chat_completion(
            input=[{"role": "user", "content": query}],
            model=self.model,
            temperature=0.5,
            tools=tools,
        )

    def deep_research(
        self,
        topic: str,
        focus_areas: Optional[List[str]] = None,
        allowed_domains: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Perform deep research on a topic using web search.
        The model will iteratively call search tools to gather comprehensive information.
        Reference: https://docs.x.ai/docs/guides/tools/search-tools

        Args:
            topic: The research topic
            focus_areas: Specific areas to focus on
            allowed_domains: Domains to search within
        """
        focus_text = (
            f"Focus on these specific areas: {', '.join(focus_areas)}."
            if focus_areas
            else ""
        )

        prompt = f"""Conduct comprehensive research on: {topic}

{focus_text}

Provide a detailed analysis including:
1. Overview and key findings
2. Recent developments and trends
3. Important statistics and data
4. Expert opinions and credible sources
5. Relevant links and references

Use web search to gather current and accurate information."""

        return self.search_web(
            query=prompt,
            allowed_domains=allowed_domains,
            enable_image_understanding=True,
        )

    def get_trending_on_x(
        self,
        location: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Get what's trending on X/Twitter.
        Reference: https://docs.x.ai/docs/guides/tools/search-tools

        Args:
            location: Geographic location (e.g., "United States", "London")
        """
        location_text = f" in {location}" if location else " globally"
        prompt = f"What are the top trending topics and discussions on X/Twitter{location_text} right now? Provide details about each trend including what it's about and key posts."

        return self.search_x(
            query=prompt,
            enable_image_understanding=True,
        )
