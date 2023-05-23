import requests
import socket
from typing import Any, Dict, TypedDict, Union, Literal


class NetworkOptions(TypedDict, total=False):
    base_url: str


class NetworkResponse(TypedDict):
    data: Dict[str, Any]
    status_code: int
    options: Dict[str, Any]


class NetworkError(Exception):
    def __init__(self, response: NetworkResponse) -> None:
        self.response = response
        super().__init__(f"[NetworkError]: {response['status_code']}")


class NetworkRequestOptions(TypedDict, total=False):
    url: str
    method: Union[Literal['GET'], Literal['POST'], Literal['PUT'], Literal['PATCH'], Literal['DELETE']]
    data: Dict[str, Any]
    headers: Dict[str, str]


class Network:
    def __init__(self, options: NetworkOptions = {}) -> None:
        self.options = options

    def request(self, options: NetworkRequestOptions) -> NetworkResponse:
        try:
            url = options['url']
            if self.options['base_url']:
                url = self.options['base_url'] + url
            method = options['method']
            data = options.get('data', {})
            headers = options.get('headers', {})

            response = requests.request(method, url, json=data, headers=headers)

            network_response: NetworkResponse = {
                'data': response.json(),
                'status_code': response.status_code,
                'options': {**self.options, **options}
            }

            if response.ok:
                return network_response
            else:
                raise NetworkError(network_response)
        except requests.exceptions.RequestException as error:
            raise NetworkError({
                'data': error.response.json(),
                'status_code': error.response.status_code,
                'options': {**self.options, **options}
            }) from error
        except Exception as error:
            raise NetworkError({
                'data': {},
                'status_code': 500,
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
