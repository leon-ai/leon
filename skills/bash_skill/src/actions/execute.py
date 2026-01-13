from bridges.python.src.sdk.leon import leon
from bridges.python.src.sdk.types import ActionParams
from bridges.python.src.sdk.settings import Settings
from bridges.python.src.sdk.tools.bash_tool import BashTool
from bridges.python.src.sdk.tools.openrouter_tool import OpenRouterTool


def run(params: ActionParams) -> None:
    """Execute bash commands based on natural language instructions"""

    # Get the user query
    query = params.get('utterance', '').strip()
    if not query:
        leon.answer({'key': 'invalid_command', 'data': {'query': 'Empty query'}})
        return

    # Load settings
    try:
        settings_manager = Settings()
        settings = settings_manager.get()
    except Exception:
        settings = {}

    # Check if OpenRouter API key is configured
    openrouter_api_key = settings.get('openrouter_api_key')
    if not openrouter_api_key:
        leon.answer({
            'key': 'llm_error',
            'data': {
                'error': 'OpenRouter API key not configured. Please add your OpenRouter API key to settings.json'
            }
        })
        return

    # Initialize OpenRouter tool
    openrouter_tool = OpenRouterTool(api_key=openrouter_api_key)

    # Initialize bash tool
    bash_tool = BashTool()

    # Show that we're processing the query
    leon.answer({'key': 'understanding_query'})

    try:
        # Get the preferred model from settings, default to Claude 3.5 Sonnet
        preferred_model = settings.get('preferred_llm_model', 'claude-3.5-sonnet')

        # Define the system prompt for bash command generation
        system_prompt = """You are a bash command generator. Given a natural language request, generate the appropriate bash command.

IMPORTANT RULES:
1. Only generate safe, non-destructive commands
2. Never generate commands that could harm the system (rm -rf /, format, etc.)
3. Provide the command, confidence level (0-100), brief explanation, and reasoning
4. If the request is unclear or unsafe, return confidence 0 and explanation why"""

        # Define JSON schema for structured output
        json_schema = {
            'name': 'bash_command',
            'schema': {
                'type': 'object',
                'properties': {
                    'command': {
                        'type': 'string',
                        'description': 'The bash command to execute, or empty string if unsafe'
                    },
                    'confidence': {
                        'type': 'integer',
                        'minimum': 0,
                        'maximum': 100,
                        'description': 'Confidence level in the generated command (0-100)'
                    },
                    'explanation': {
                        'type': 'string',
                        'description': 'Brief explanation of what this command does'
                    },
                    'reasoning': {
                        'type': 'string',
                        'description': 'Why this command was chosen for the user request'
                    }
                },
                'required': ['command', 'confidence', 'explanation', 'reasoning'],
                'additionalProperties': False
            }
        }

        # Generate command using OpenRouter structured completion
        response = openrouter_tool.structured_completion(
            prompt=query,
            json_schema=json_schema,
            model=preferred_model,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=512
        )

        print('OpenRouter response:', response)

        if not response['success']:
            leon.answer({
                'key': 'llm_error',
                'data': {'error': response['error']}
            })
            return

        # Extract data from structured response
        llm_data = response['data']
        command = llm_data.get('command', '').strip()
        confidence = llm_data.get('confidence', 0)
        explanation = llm_data.get('explanation', '')
        reasoning = llm_data.get('reasoning', '')

        print('Generated command:', command)
        print('Confidence:', confidence)

        # Check if LLM generated a valid command
        if not command or confidence < 20:
            leon.answer({
                'key': 'invalid_command',
                'data': {
                    'query': query,
                    'error': explanation or 'Low confidence in generated command'
                }
            })
            return

        # Additional safety check using bash tool
        if not bash_tool.is_safe_command(command):
            leon.answer({
                'key': 'invalid_command',
                'data': {
                    'query': query,
                    'error': 'Command failed safety validation'
                }
            })
            return

        # Check if command requires confirmation
        risk_level = bash_tool.get_command_risk_level(command)
        requires_confirmation = risk_level in ['medium', 'high', 'critical']

        # For this simple implementation, we'll skip user confirmation in non-interactive environments
        # and just inform the user about risky commands
        if requires_confirmation:
            risk_description = bash_tool.get_risk_description(command)
            leon.answer({
                'key': 'confirmation_needed',
                'data': {
                    'command': command,
                    'risk_description': risk_description
                }
            })

            # For now, we'll only execute low-risk commands automatically
            # Medium/high risk commands will require manual intervention
            if risk_level in ['high', 'critical']:
                leon.answer({'key': 'cancelled'})
                return

        # Execute the command
        leon.answer({
            'key': 'executing_command',
            'data': {'command': command}
        })

        result = bash_tool.execute_bash_command(command)

        if result['success']:
            output = result['stdout']
            if not output:
                output = "Command completed successfully (no output)"

            leon.answer({
                'key': 'command_success',
                'data': {'output': output}
            })
        else:
            error = result['stderr'] or f"Command failed with exit code {result['returncode']}"
            leon.answer({
                'key': 'command_failed',
                'data': {'error': error}
            })

    except Exception as e:
        leon.answer({
            'key': 'llm_error',
            'data': {'error': str(e)}
        })
