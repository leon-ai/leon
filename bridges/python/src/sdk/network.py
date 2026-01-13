import requests
import socket
from typing import Any, Dict, TypedDict, Union, Literal, Optional

from ..constants import LEON_VERSION, PYTHON_BRIDGE_VERSION


class NetworkOptions(TypedDict, total=False):
    base_url: Optional[str]


class NetworkResponse(TypedDict):
    data: Any
    status_code: int
    options: Dict[str, Any]


class NetworkError(Exception):
    def __init__(self, response: NetworkResponse) -> None:
        self.response = response
        super().__init__(f"[NetworkError]: {response['status_code']} {response['data']}")


class NetworkRequestOptions(TypedDict, total=False):
    url: str
    method: Union[Literal['GET'], Literal['POST'], Literal['PUT'], Literal['PATCH'], Literal['DELETE']]
    data: Dict[str, Any]
    headers: Dict[str, str]
    files: Dict[str, Any]
    use_json: bool
    response_type: Optional[Union[Literal['json'], Literal['text'], Literal['arraybuffer'], Literal['bytes']]]

class Network:
    def __init__(self, options: NetworkOptions = {'base_url': None}) -> None:
        self.options = options

    def request(self, options: NetworkRequestOptions) -> NetworkResponse:
        try:
            url = options['url']

            if self.options['base_url'] is not None:
                url = (self.options['base_url'] or '') + url

            method = options['method']
            data = options.get('data', {})
            headers = options.get('headers', {})
            files = options.get('files')
            use_json = options.get('use_json', True)
            response_type = options.get('response_type', 'json')

            request_kwargs: Dict[str, Any] = {
                'headers': {
                    'User-Agent': f"Leon Personal Assistant {LEON_VERSION} - Python Bridge {PYTHON_BRIDGE_VERSION}",
                    **headers
                }
            }

            # If files are provided or JSON is explicitly disabled, send form data
            if files or not use_json:
                request_kwargs['data'] = data
                if files:
                    request_kwargs['files'] = files
            else:
                request_kwargs['json'] = data

            response = requests.request(
                method,
                url,
                **request_kwargs
            )

            parsed_data: Any
            if response_type in ['arraybuffer', 'bytes']:
                parsed_data = response.content
            else:
                try:
                    parsed_data = response.json()
                except Exception:
                    parsed_data = response.text

            network_response: NetworkResponse = {
                'data': parsed_data,
                'status_code': response.status_code,
                'options': {**self.options, **options}
            }

            if response.ok:
                return network_response
            else:
                raise NetworkError(network_response)
        except requests.exceptions.RequestException as error:
            status_code = 500
            raw_data: Any = ''

            if error.response is not None:
                status_code = error.response.status_code
                try:
                    raw_data = error.response.json()
                except Exception:
                    raw_data = error.response.text

            raise NetworkError({
                'data': raw_data,
                'status_code': status_code,
                'options': {**self.options, **options}
            }) from error

    def is_network_error(self, error: Exception) -> bool:
        return isinstance(error, NetworkError)

    def is_network_available(self) -> bool:
        try:
            socket.gethostbyname('getleon.ai')

            return True
        except socket.error:
            return False
