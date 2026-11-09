import { captureImage } from '../../visual-export/capture-image'

window.auroraImageRuntime = async (): Promise<Blob> => {
  const fonts = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
    .filter((rule) => rule instanceof CSSFontFaceRule).map((rule) => rule.cssText).join('\n')

  return captureImage(document.body, fonts, () => window.auroraChartsRuntime?.snapshots(document.body) ?? new Map())
}
