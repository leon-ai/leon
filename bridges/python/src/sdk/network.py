import json
import requests
import socket
import sys
from ipaddress import ip_address
from urllib.parse import urlsplit
from typing import Any, Dict, TypedDict, Union, Literal, Optional

from ..constants import LEON_VERSION, PYTHON_BRIDGE_VERSION


class NetworkOptions(TypedDict, total=False):
    base_url: Optional[str]


class NetworkResponse(TypedDict):
    data: Any
    # Zero means the transport failed before receiving an HTTP response.
    status_code: int
    options: Dict[str, Any]


class NetworkError(Exception):
    """Report HTTP failures or the original cause when no response was received."""

    def __init__(
        self, response: NetworkResponse, cause: Optional[Exception] = None
    ) -> None:
        self.response = response
        detail = str(cause) if cause is not None else str(response['status_code'])
        super().__init__(f"[NetworkError]: {detail}")

    @staticmethod
    def _format_error_data(data: Any) -> str:
        if isinstance(data, str):
            return data

        try:
            return json.dumps(data)
        except Exception:
            return str(data)


class NetworkRequestOptions(TypedDict, total=False):
    url: str
    method: Union[Literal['GET'], Literal['POST'], Literal['PUT'], Literal['PATCH'], Literal['DELETE']]
    data: Dict[str, Any]
    headers: Dict[str, str]
    # Requests uses seconds; the SDK exposes milliseconds in both bridges.
    timeout_ms: int
    # Preserve the URL's Host, SNI and certificate hostname when selecting a peer.
    connect_address: str
    files: Dict[str, Any]
    use_json: bool
    response_type: Optional[Union[Literal['json'], Literal['text'], Literal['arraybuffer'], Literal['bytes']]]


class _AddressAdapter(requests.adapters.HTTPAdapter):
    """Select a direct peer without changing HTTPS identity or proxy routing."""

    def __init__(self, address: str) -> None:
        self.address = str(ip_address(address))
        super().__init__()

    def get_connection_with_tls_context(
        self, request, verify, proxies=None, cert=None
    ):
        # A proxy owns origin resolution; preserve its routing policy.
        if requests.utils.select_proxy(request.url, proxies):
            return super().get_connection_with_tls_context(
                request, verify, proxies, cert
            )

        host_params, pool_kwargs = self.build_connection_pool_key_attributes(
            request, verify, cert
        )
        hostname = host_params["host"]
        host_params["host"] = self.address
        request.headers["Host"] = urlsplit(request.url).netloc
        if host_params["scheme"] == "https":
            pool_kwargs["server_hostname"] = hostname
            pool_kwargs["assert_hostname"] = hostname

        return self.poolmanager.connection_from_host(
            **host_params, pool_kwargs=pool_kwargs
        )


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

            if options.get('timeout_ms') is not None:
                request_kwargs['timeout'] = options['timeout_ms'] / 1_000

            # If files are provided or JSON is explicitly disabled, send form data
            if files or not use_json:
                request_kwargs['data'] = data
                if files:
                    request_kwargs['files'] = files
            else:
                request_kwargs['json'] = data

            address = options.get('connect_address')
            if address:
                # A separate session prevents reuse of a connection to a failed peer.
                with requests.Session() as session:
                    adapter = _AddressAdapter(address)
                    session.mount('https://', adapter)
                    session.mount('http://', adapter)
                    response = session.request(
                        method, url, allow_redirects=False, **request_kwargs
                    )
            else:
                response = requests.request(method, url, **request_kwargs)

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

            if response.ok and not (address and response.is_redirect):
                return network_response
            else:
                print(
                    '[NetworkError]',
                    network_response['status_code'],
                    options.get('method'),
                    options.get('url'),
                    NetworkError._format_error_data(network_response['data']),
                    file=sys.stderr
                )
                raise NetworkError(network_response)
        except requests.exceptions.RequestException as error:
            # Transport failures have no HTTP status; preserve their actual cause.
            status_code = 0
            raw_data: Any = ''

            if error.response is not None:
                status_code = error.response.status_code
                try:
                    raw_data = error.response.json()
                except Exception:
                    raw_data = error.response.text

            response_payload: NetworkResponse = {
                'data': raw_data,
                'status_code': status_code,
                'options': {**self.options, **options}
            }

            print(
                '[NetworkError]',
                response_payload['status_code'],
                options.get('method'),
                options.get('url'),
                str(error),
                NetworkError._format_error_data(response_payload['data']),
                file=sys.stderr
            )

            raise NetworkError(response_payload, error) from error

    def is_network_error(self, error: Exception) -> bool:
        return isinstance(error, NetworkError)

    def is_network_available(self) -> bool:
        try:
            socket.gethostbyname('getleon.ai')

            return True
        except socket.error:
            return False
