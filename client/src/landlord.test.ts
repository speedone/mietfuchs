// Vermieter, Bankverbindung und Zahlungsfrist auf dem Ausdruck (#92): Das Objekt geht vor, und
// `null` heißt „die Vorgabe aus den Einstellungen gilt“. Eine leere Angabe am Objekt ist dagegen
// eine Angabe, etwa für ein Haus, dessen Miete bar gezahlt wird.
import { expect, test } from 'vitest'
import { effectiveLandlord } from './landlord'
import type { Property } from './types'

const vorgabe = { landlordName: 'Erika Muster', iban: 'DE01', paymentDeadlineDays: 30 }
const objekt = (abweichend: Partial<Property>): Property => ({
  id: 'o', name: 'X', kind: 'mfh', address: '', landlordName: null, iban: null, paymentDeadlineDays: null, ...abweichend,
})

test('ohne Abweichung gilt die Vorgabe', () => {
  expect(effectiveLandlord(objekt({}), vorgabe)).toEqual(vorgabe)
  expect(effectiveLandlord(null, vorgabe)).toEqual(vorgabe)
})

test('was am Objekt steht, geht vor, auch eine leere Angabe', () => {
  expect(effectiveLandlord(objekt({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14 }), vorgabe))
    .toEqual({ landlordName: 'Erbengemeinschaft Muster', iban: '', paymentDeadlineDays: 14 })
})
