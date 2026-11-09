declare module 'virtual:aurora-sandbox' {
  const source: string
  export default source
}

declare module 'virtual:aurora-charts' {
  const source: {
    entry: string
    load: () => Promise<Record<string, { source: string, imports: string[] }>>
  }
  export default source
}

declare module 'virtual:aurora-controls' {
  const source: {
    entry: string
    load: () => Promise<Record<string, { source: string, imports: string[] }>>
  }
  export default source
}

declare module 'virtual:aurora-export' {
  const source: {
    entry: string
    load: () => Promise<Record<string, { source: string, imports: string[] }>>
  }
  export default source
}
