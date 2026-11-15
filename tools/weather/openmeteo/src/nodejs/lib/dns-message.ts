const HEADER_BYTES = 12
const RECORD_HEADER_BYTES = 10
const TYPE_A = 1
const CLASS_IN = 1
const IPV4_BYTES = 4
const MAX_LABEL_BYTES = 63
const MAX_NAME_BYTES = 255
const RECURSION_DESIRED = 0x0100
const RESPONSE_FLAG = 0x8000
const RESPONSE_FLAGS_MASK = 0xfa0f
const COMPRESSION_MASK = 0xc0
const POINTER_MASK = 0x3fff

function skipName(message: Buffer, start: number): number {
  let offset = start
  while (offset < message.length) {
    const length = message[offset]!
    if ((length & COMPRESSION_MASK) === COMPRESSION_MASK) {
      // Names need not be expanded to extract addresses; never follow pointers.
      const pointer = message.readUInt16BE(offset) & POINTER_MASK
      if (pointer < HEADER_BYTES || pointer >= offset) {
        break
      }
      return offset + 2
    }
    if (length > MAX_LABEL_BYTES) {
      break
    }
    offset += length + 1
    if (length === 0) {
      return offset
    }
  }

  throw new Error('Invalid DNS name.')
}

/**
 * Encode a single IPv4 question for the standard DoH GET protocol.
 */
export function createDnsQuery(hostname: string): Buffer {
  const labels = hostname.split('.').map((label) => {
    const bytes = Buffer.from(label, 'ascii')
    if (!bytes.length || bytes.length > MAX_LABEL_BYTES) {
      throw new Error('Invalid DNS hostname.')
    }
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  const name = Buffer.concat([...labels, Buffer.from([0])])
  if (name.length > MAX_NAME_BYTES) {
    throw new Error('Invalid DNS hostname.')
  }
  const header = Buffer.alloc(HEADER_BYTES)
  header.writeUInt16BE(RECURSION_DESIRED, 2)
  header.writeUInt16BE(1, 4)
  const question = Buffer.alloc(4)
  question.writeUInt16BE(TYPE_A, 0)
  question.writeUInt16BE(CLASS_IN, 2)

  return Buffer.concat([header, name, question])
}

/**
 * Read IPv4 answers and TTLs, rejecting truncated or mismatched DNS messages.
 * The origin's HTTPS certificate still authenticates every selected weather peer.
 */
export function readDnsAddresses(message: Buffer, query: Buffer): { ip: string, ttl: number }[] {
  if (message.length < query.length ||
      message.readUInt16BE(0) !== query.readUInt16BE(0) ||
      (message.readUInt16BE(2) & RESPONSE_FLAGS_MASK) !== RESPONSE_FLAG ||
      message.readUInt16BE(4) !== 1 ||
      !message.subarray(HEADER_BYTES, query.length).equals(query.subarray(HEADER_BYTES))) {
    throw new Error('Invalid DNS response.')
  }

  const addresses: { ip: string, ttl: number }[] = []
  const answerCount = message.readUInt16BE(6)
  let offset = query.length
  let minimumTtl = Infinity
  for (let index = 0; index < answerCount; index += 1) {
    offset = skipName(message, offset)
    if (offset + RECORD_HEADER_BYTES > message.length) {
      throw new Error('Truncated DNS record.')
    }
    const type = message.readUInt16BE(offset)
    const recordClass = message.readUInt16BE(offset + 2)
    const ttl = message.readUInt32BE(offset + 4)
    minimumTtl = Math.min(minimumTtl, ttl)
    const length = message.readUInt16BE(offset + 8)
    offset += RECORD_HEADER_BYTES
    if (offset + length > message.length) {
      throw new Error('Truncated DNS address.')
    }
    if (type === TYPE_A && recordClass === CLASS_IN && length === IPV4_BYTES) {
      addresses.push({ ip: [...message.subarray(offset, offset + length)].join('.'), ttl })
    }
    offset += length
  }

  // A shorter CNAME lifetime also bounds the lifetime of its resolved address.
  return addresses.map((address) => ({ ...address, ttl: Math.min(address.ttl, minimumTtl) }))
}
