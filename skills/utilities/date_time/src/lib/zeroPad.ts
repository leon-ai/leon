/**
 * Pads a number with zeros.
 *
 * @example zeroPad(1, 2) // '01'
 * @example zeroPad(10, 2) // '10'
 */
export const zeroPad = (number: number, places = 2): string => {
  return number.toString().padStart(places, '0')
}
