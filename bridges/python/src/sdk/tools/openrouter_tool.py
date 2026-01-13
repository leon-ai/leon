import json
from typing import Dict, Any, Optional, List
from ..base_tool import BaseTool
from ..toolkit_config import ToolkitConfig
from ..network import Network, NetworkError


class OpenRouterTool(BaseTool):
    """OpenRouter tool for unified LLM API access across all skills"""

    TOOLKIT = 'communication'

    def __init__(self, api_key: Optional[str] = None):
        super().__init__()
        # Load configuration from central toolkits directory
        tool_config_name = self.__class__.__name__.lower().replace('tool', '')
        self.config = ToolkitConfig.load(self.TOOLKIT, tool_config_name)
        self.api_key = api_key
        self.network = Network({'base_url': 'https://openrouter.ai/api'})

        # Popular models available on OpenRouter (Updated January 2025)
        self.popular_models = {
            # OpenAI Models - Latest GPT-5 and o-series
            'gpt-5': 'openai/gpt-5',  # Latest flagship model (August 2025)
            'gpt-4o': 'openai/gpt-4o-2024-11-20',
            'gpt-4o-mini': 'openai/gpt-4o-mini-2024-07-18',
            'o1': 'openai/o1',
            'o1-mini': 'openai/o1-mini',
            'o1-preview': 'openai/o1-preview',
            'o3-mini': 'openai/o3-mini',
            'gpt-4-turbo': 'openai/gpt-4-turbo',

            # Anthropic Models - Latest Claude 4 and 3.7 series
            'claude-4-sonnet': 'anthropic/claude-4-sonnet-20250522',  # Latest Claude 4 Sonnet
            'claude-3.7-sonnet': 'anthropic/claude-3.7-sonnet-20250109',  # Extended thinking model
            'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet-20241022',
            'claude-3.5-haiku': 'anthropic/claude-3.5-haiku-20241022',
            'claude-3-opus': 'anthropic/claude-3-opus',
            'claude-3-sonnet': 'anthropic/claude-3-sonnet',

            # Google Models - Gemini 2.0 and 2.5 series
            'gemini-2.5-flash': 'google/gemini-2.5-flash',
            'gemini-2.5-pro': 'google/gemini-2.5-pro',
            'gemini-2.0-flash': 'google/gemini-2.0-flash',
            'gemini-1.5-pro': 'google/gemini-1.5-pro',
            'gemini-1.5-flash': 'google/gemini-1.5-flash-002',

            # DeepSeek Models - Latest V3 and R1 reasoning models
            'deepseek-r1': 'deepseek/deepseek-r1',
            'deepseek-v3': 'deepseek/deepseek-v3',
            'deepseek-chat': 'deepseek/deepseek-chat',

            # Qwen Models - Latest Qwen 3 Coder series (July 2025)
            'qwen-3-coder': 'qwen/qwen-3-coder-32b-instruct',  # Latest coding model
            'qwen-2.5-max': 'qwen/qwen-2.5-max',
            'qwen-2.5-72b': 'qwen/qwen-2.5-72b-instruct',

            # Moonshot AI Kimi Models - Latest K2 (July 2025)
            'kimi-k2': 'moonshotai/kimi-k2-instruct',  # Latest 1T parameter MoE model
            'kimi-k1.5': 'moonshotai/kimi-k1.5',

            # Meta Llama Models - Latest 3.3 and 3.2 series
            'llama-3.3-70b': 'meta-llama/llama-3.3-70b-instruct',
            'llama-3.2-90b': 'meta-llama/llama-3.2-90b-vision-instruct',
            'llama-3.2-11b': 'meta-llama/llama-3.2-11b-vision-instruct',
            'llama-3.1-405b': 'meta-llama/llama-3.1-405b-instruct',
            'llama-3.1-70b': 'meta-llama/llama-3.1-70b-instruct',
            'llama-3.1-8b': 'meta-llama/llama-3.1-8b-instruct',

            # Mistral Models - Latest Large 2 series
            'mistral-large-2': 'mistralai/mistral-large-2',
            'mistral-small': 'mistralai/mistral-small',
            'mixtral-8x7b': 'mistralai/mixtral-8x7b-instruct',

            # xAI Grok Models - Latest Grok 3 series
            'grok-3': 'x-ai/grok-3',
            'grok-2': 'x-ai/grok-2-1212',

            # Cohere Models
            'command-r-plus': 'cohere/command-r-plus',
            'command-r': 'cohere/command-r',

            # Other High-Performance Models
            'yi-large': 'yi/yi-large',
        }

    @property
    def tool_name(self) -> str:
        return self.__class__.__name__

    @property
    def toolkit(self) -> str:
        return self.TOOLKIT

    @property
    def description(self) -> str:
        return self.config['description']

    def set_api_key(self, api_key: str) -> None:
        """Set the OpenRouter API key"""
        self.api_key = api_key

    def get_available_models(self) -> List[str]:
        """Get list of popular available models"""
        return list(self.popular_models.keys())

    def get_model_id(self, model_name: str) -> str:
        """Convert friendly model name to OpenRouter model ID"""
        return self.popular_models.get(model_name, model_name)

    def chat_completion(
            self,
            messages: List[Dict[str, str]],
            model: str = 'gemini-2.5-flash',
            temperature: float = 0.7,
            max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        use_structured_output: bool = False,
        json_schema: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Send a chat completion request to OpenRouter
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            model: Model name (friendly name or full model ID)
            temperature: Sampling temperature (0-2)
            max_tokens: Maximum tokens to generate
            system_prompt: System prompt to prepend
            use_structured_output: Whether to use OpenRouter's structured outputs
            json_schema: JSON schema for structured output (required if use_structured_output=True)
            
        Returns:
            Dict with response data or error information
        """
        if not self.api_key:
            return {
                'success': False,
                'error': 'OpenRouter API key not configured'
            }

        # Convert friendly model name to OpenRouter ID
        model_id = self.get_model_id(model)

        # Prepare messages with system prompt if provided
        request_messages = []
        if system_prompt:
            request_messages.append({'role': 'system', 'content': system_prompt})
        request_messages.extend(messages)

        # Prepare request payload
        payload = {
            'model': model_id,
            'messages': request_messages,
            'temperature': temperature
        }

        if max_tokens:
            payload['max_tokens'] = max_tokens

        # Add structured output configuration if requested
        if use_structured_output and json_schema:
            payload['response_format'] = {
                'type': 'json_schema',
                'json_schema': {
                    'name': json_schema.get('name', 'response'),
                    'strict': True,
                    'schema': json_schema['schema']
                }
            }

        try:
            response = self.network.request({
                'url': '/v1/chat/completions',
                'method': 'POST',
                'headers': {
                    'Authorization': f'Bearer {self.api_key}',
                    'Content-Type': 'application/json'
                },
                'data': payload
            })

            return {
                'success': True,
                'data': response['data'],
                'model_used': model_id
            }

        except NetworkError as e:
            return {
                'success': False,
                'error': f'OpenRouter API error: {str(e)}',
                'status_code': getattr(e.response, 'status_code', None)
            }

    def completion(
            self,
        prompt: str,
        model: str = 'gemini-2.5-flash',
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None,
        use_structured_output: bool = False,
        json_schema: Optional[Dict[str, Any]] = None
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
        messages = [{'role': 'user', 'content': prompt}]

        response = self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
            use_structured_output=use_structured_output,
            json_schema=json_schema
        )

        if not response['success']:
            return response

        try:
            content = response['data']['choices'][0]['message']['content']
            return {
                'success': True,
                'content': content,
                'model_used': response['model_used']
            }
        except (KeyError, IndexError) as e:
            return {
                'success': False,
                'error': f'Failed to extract completion: {str(e)}'
            }

    def structured_completion(
            self,
            prompt: str,
        json_schema: Dict[str, Any],
            model: str = 'gemini-2.5-flash',
            temperature: float = 0.7,
            max_tokens: Optional[int] = None,
        system_prompt: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Generate structured JSON output using OpenRouter's structured outputs feature
        
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
        messages = [{'role': 'user', 'content': prompt}]

        response = self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            system_prompt=system_prompt,
            use_structured_output=True,
            json_schema=json_schema
        )

        if not response['success']:
            return response

        try:
            content = response['data']['choices'][0]['message']['content']
            # With structured outputs, content is already valid JSON
            parsed_data = json.loads(content)
            return {
                'success': True,
                'data': parsed_data,
                'model_used': response['model_used']
            }
        except (KeyError, IndexError) as e:
            return {
                'success': False,
                'error': f'Failed to extract completion: {str(e)}'
            }
        except json.JSONDecodeError as e:
            return {
                'success': False,
                'error': f'Failed to parse JSON response: {str(e)}'
            }

    def list_models(self) -> Dict[str, Any]:
        """
        Get list of available models from OpenRouter API
        
        Returns:
            Dict with models list or error
        """
        if not self.api_key:
            return {
                'success': False,
                'error': 'OpenRouter API key not configured'
            }

        try:
            response = self.network.request({
                'url': '/v1/models',
                'method': 'GET',
                'headers': {
                    'Authorization': f'Bearer {self.api_key}'
                }
            })

            return {
                'success': True,
                'models': response['data']['data']
            }

        except NetworkError as e:
            return {
                'success': False,
                'error': f'Failed to fetch models: {str(e)}'
            }
