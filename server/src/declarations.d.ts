/* eslint-disable @typescript-eslint/ban-types */

declare module '@ffprobe-installer/ffprobe' {
  export const path: string
}

/**
 * NLP.js type definitions
 * @see https://github.com/axa-group/nlp.js/tree/master/packages
 */
interface BuiltinMicrosoft<T> {
  new (settings: unknown, container: unknown): T
}
interface Nlp<T> {
  new (settings: unknown, container: unknown): T
}
interface LangAll {
  register(container: unknown)
}

declare module '@nlpjs/core-loader' {
  export const containerBootstrap: Function
}
declare module '@nlpjs/nlp' {
  export const Nlp: Nlp
}
declare module '@nlpjs/builtin-microsoft' {
  export const BuiltinMicrosoft: BuiltinMicrosoft
}
declare module '@nlpjs/lang-all' {
  export const LangAll: LangAll
}
