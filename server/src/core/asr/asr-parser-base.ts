export abstract class ASRParserBase {
  protected abstract name: string

  protected abstract parse(buffer: Buffer | string): Promise<string | null>
}
