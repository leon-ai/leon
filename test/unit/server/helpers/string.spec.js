import string from '@/helpers/string-helper'

describe('string helper', () => {
  describe('pnr()', () => {
    test('replaces substring to a string defined in an object', () => {
      expect(StringHelper.pnr('Hello %name%', { '%name%': 'Leon' })).toBe(
        'Hello Leon'
      )
    })
  })

  describe('ucfirst()', () => {
    test('transforms first letter to uppercase', () => {
      expect(StringHelper.ucfirst('leon')).toBe('Leon')
    })
  })

  describe('snakeToPascalCase()', () => {
    test('transforms snake_case string to PascalCase', () => {
      expect(StringHelper.snakeToPascalCase('leon')).toBe('Leon')
      expect(StringHelper.snakeToPascalCase('this_is_leon')).toBe('ThisIsLeon')
    })
  })

  describe('random()', () => {
    test('generates a random string with a length defined by a given number', () => {
      const s = StringHelper.random(6)
      expect(typeof s).toBe('string')
      expect(s.length).toBe(6)
    })
  })

  describe('removeAccents()', () => {
    test('removes accents', () => {
      expect(StringHelper.removeAccents('àâèéêëîïôöûüùÛÜç')).toBe(
        'aaeeeeiioouuuUUc'
      )
    })
  })

  describe('removeEndPunctuation()', () => {
    test('removes end-punctuation', () => {
      expect(StringHelper.removeEndPunctuation('Who are you?')).toBe(
        'Who are you'
      )
      expect(StringHelper.removeEndPunctuation('This is great.')).toBe(
        'This is great'
      )
      expect(
        StringHelper.removeEndPunctuation('This string has no punctuation')
      ).toBe('This string has no punctuation')
    })
  })
})
