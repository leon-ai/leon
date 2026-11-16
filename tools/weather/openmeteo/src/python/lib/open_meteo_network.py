import socket
from base64 import urlsafe_b64encode
from threading import Event
from time import monotonic
from typing import Any
from urllib.parse import urlsplit

from bridges.python.src.sdk.network import Network, NetworkError

from .dns_message import create_dns_query, read_dns_addresses

REQUEST_TIMEOUT_MS = 4_000
DNS_TIMEOUT_MS = 1_500
MAX_FALLBACK_ATTEMPTS = 2
RETRYABLE_STATUSES = {0, 500, 502, 503, 504}
# Interleave mainland and international services, bootstrapping independently of DNS.
DNS_ENDPOINTS = (
    ("https://dns.alidns.com/dns-query", "223.5.5.5"),
    ("https://cloudflare-dns.com/dns-query", "1.1.1.1"),
    ("https://doh.pub/dns-query", "1.12.12.12"),
    ("https://dns.google/dns-query", "8.8.8.8"),
)


class OpenMeteoNetwork:
    """Recover from unhealthy regional peers using alternate DNS answers."""

    def __init__(self, base_url: str) -> None:
        self.network = Network({"base_url": base_url})
        self.dns_network = Network()
        self.hostname = urlsplit(base_url).hostname
        self.cache: dict[str, list[tuple[str, float]]] = {}

    def get(self, url: str, deadline: float, signal: Event | None = None) -> Any:
        """Share the caller's execution budget across discovery and retries."""
        def request(address: str | None = None) -> Any:
            options = {
                "url": url,
                "method": "GET",
                "timeout_ms": self._remaining_timeout(deadline, REQUEST_TIMEOUT_MS, signal),
            }
            if address:
                options["connect_address"] = address
            return self.network.request(options)["data"]

        try:
            return request()
        except NetworkError as error:
            if not self._is_retryable(error):
                raise
            failure = error

        # Exclude local DNS peers, including the one that just failed.
        tried: set[str] = set()
        try:
            tried.update(
                entry[4][0] for entry in socket.getaddrinfo(
                    self.hostname, None, type=socket.SOCK_STREAM
                )
            )
        except OSError:
            # Alternate DNS can recover from local resolution failures as well.
            pass

        attempts = 0
        for endpoint in DNS_ENDPOINTS:
            self._remaining_timeout(deadline, DNS_TIMEOUT_MS, signal)
            try:
                addresses = self._resolve(endpoint, deadline, signal)
            except (NetworkError, ValueError, TypeError, AttributeError, KeyError):
                # Preserve the weather error when a public resolver is unavailable.
                continue

            for address, _ in addresses:
                if address in tried:
                    continue
                tried.add(address)
                attempts += 1
                try:
                    return request(address)
                except NetworkError as error:
                    if not self._is_retryable(error):
                        raise
                    failure = error
                if attempts >= MAX_FALLBACK_ATTEMPTS:
                    raise failure

        raise failure

    @staticmethod
    def _is_retryable(error: NetworkError) -> bool:
        return error.response["status_code"] in RETRYABLE_STATUSES

    @staticmethod
    def _remaining_timeout(deadline: float, limit: int, signal: Event | None) -> int:
        if signal and signal.is_set():
            raise RuntimeError("Weather request cancelled.")
        remaining = (deadline - monotonic()) * 1_000
        if remaining <= 0:
            raise TimeoutError("Weather request deadline exceeded.")
        return max(1, min(limit, int(remaining))) if remaining != float("inf") else limit

    def _resolve(
        self, endpoint: tuple[str, str], deadline: float, signal: Event | None
    ) -> list[tuple[str, float]]:
        url, address = endpoint
        cached = [entry for entry in self.cache.get(url, []) if entry[1] > monotonic()]
        if cached:
            return cached

        # DNS queries contain only the hostname, never the owner's weather query.
        query = create_dns_query(self.hostname)
        encoded_query = urlsafe_b64encode(query).rstrip(b"=").decode("ascii")
        data = self.dns_network.request({
            "url": f"{url}?dns={encoded_query}",
            "method": "GET",
            "connect_address": address,
            "headers": {"Accept": "application/dns-message"},
            "response_type": "bytes",
            # Standard DoH GET carries the question in the URL, with no request body.
            "use_json": False,
            "timeout_ms": self._remaining_timeout(deadline, DNS_TIMEOUT_MS, signal),
        })["data"]
        addresses = [
            (address, monotonic() + ttl)
            for address, ttl in read_dns_addresses(data, query)
        ]

        self.cache[url] = addresses
        return addresses
