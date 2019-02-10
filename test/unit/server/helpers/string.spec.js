'use strict'

import string from '@/helpers/string'

describe('string helper', () => {
  describe('pnr()', () => {
    test('replaces substring to a string defined in an object', () => {
      expect(string.pnr('Hello %name%', { '%name%': 'Leon' })).toBe('Hello Leon')
    })
  })

  describe('ucfirst()', () => {
    test('transforms first letter to uppercase', () => {
      expect(string.ucfirst('leon')).toBe('Leon')
    })
  })

  describe('random()', () => {
    test('generates a random string with a length defined by a given number', () => {
      const s = string.random(6)
      expect(typeof s).toBe('string')
      expect(s.length).toBe(6)
    })
  })

  describe('removeAccents()', () => {
    test('removes accents', () => {
      expect(string.removeAccents('àâèéêëîïôöûüùÛÜç')).toBe('aaeeeeiioouuuUUc')
    })
  })
})
