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


class Network:
    def __init__(self, options: NetworkOptions = {'base_url': None}) -> None:
        self.options = options

    def request(self, options: NetworkRequestOptions) -> NetworkResponse:
        try:
            url = options['url']

            if self.options['base_url'] is not None:
                url = self.options['base_url'] + url
            method = options['method']
            data = options.get('data', {})
            headers = options.get('headers', {})
            response = requests.request(
                method,
                url,
                json=data,
                headers={
                    'User-Agent': f"Leon Personal Assistant {LEON_VERSION} - Python Bridge {PYTHON_BRIDGE_VERSION}",
                    **headers
                }
            )

            data = {}
            try:
                data = response.json()
            except Exception:
                data = response.text

            network_response: NetworkResponse = {
                'data': data,
                'status_code': response.status_code,
                'options': {**self.options, **options}
            }

            if response.ok:
                return network_response
            else:
                raise NetworkError(network_response)
        except requests.exceptions.RequestException as error:
            data = {}
            try:
                data = error.response.json()
            except Exception:
                data = error.response.text

            raise NetworkError({
                'data': data,
                'status_code': error.response.status_code,
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
