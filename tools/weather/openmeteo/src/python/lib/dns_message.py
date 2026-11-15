import struct

HEADER_BYTES = 12
RECORD_HEADER_BYTES = 10
TYPE_A = 1
CLASS_IN = 1
IPV4_BYTES = 4
MAX_LABEL_BYTES = 63
MAX_NAME_BYTES = 255
RECURSION_DESIRED = 0x0100
RESPONSE_FLAG = 0x8000
RESPONSE_FLAGS_MASK = 0xFA0F
COMPRESSION_MASK = 0xC0
POINTER_MASK = 0x3FFF


def _skip_name(message: bytes, start: int) -> int:
    offset = start
    while offset < len(message):
        length = message[offset]
        if length & COMPRESSION_MASK == COMPRESSION_MASK:
            # Do not follow compressed pointers; only the end of the name is needed.
            if offset + 2 > len(message):
                break
            pointer = struct.unpack_from("!H", message, offset)[0] & POINTER_MASK
            if pointer < HEADER_BYTES or pointer >= offset:
                break
            return offset + 2
        if length > MAX_LABEL_BYTES:
            break
        offset += length + 1
        if length == 0:
            return offset
    raise ValueError("Invalid DNS name.")


def create_dns_query(hostname: str) -> bytes:
    """Encode one IPv4 question for the standard DoH GET protocol."""
    labels = []
    for label in hostname.split("."):
        encoded = label.encode("ascii")
        if not encoded or len(encoded) > MAX_LABEL_BYTES:
            raise ValueError("Invalid DNS hostname.")
        labels.append(bytes([len(encoded)]) + encoded)
    name = b"".join(labels) + b"\x00"
    if len(name) > MAX_NAME_BYTES:
        raise ValueError("Invalid DNS hostname.")
    header = struct.pack("!6H", 0, RECURSION_DESIRED, 1, 0, 0, 0)
    return header + name + struct.pack("!2H", TYPE_A, CLASS_IN)


def read_dns_addresses(message: bytes, query: bytes) -> list[tuple[str, int]]:
    """Read IPv4 answers and TTLs, rejecting truncated or mismatched replies.

    Every selected weather peer is still authenticated by its HTTPS certificate.
    """
    if len(message) < len(query):
        raise ValueError("Truncated DNS response.")
    query_id, flags, questions, answers, _, _ = struct.unpack_from("!6H", message)
    if (
        query_id != struct.unpack_from("!H", query)[0]
        or flags & RESPONSE_FLAGS_MASK != RESPONSE_FLAG
        or questions != 1
        or message[HEADER_BYTES:len(query)] != query[HEADER_BYTES:]
    ):
        raise ValueError("Invalid DNS response.")

    addresses = []
    offset = len(query)
    minimum_ttl = float("inf")
    for _ in range(answers):
        offset = _skip_name(message, offset)
        if offset + RECORD_HEADER_BYTES > len(message):
            raise ValueError("Truncated DNS record.")
        record_type, record_class, ttl, length = struct.unpack_from("!2HIH", message, offset)
        minimum_ttl = min(minimum_ttl, ttl)
        offset += RECORD_HEADER_BYTES
        if offset + length > len(message):
            raise ValueError("Truncated DNS address.")
        if record_type == TYPE_A and record_class == CLASS_IN and length == IPV4_BYTES:
            addresses.append((".".join(str(byte) for byte in message[offset:offset + length]), ttl))
        offset += length
    # A CNAME's lifetime can be shorter than that of its resolved address.
    return [(address, min(ttl, minimum_ttl)) for address, ttl in addresses]
