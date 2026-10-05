// Wartezeit von `findBy…` und `waitFor` (Durchsicht von #221): Die Voreinstellung von Testing
// Library ist eine Sekunde. Unter Last (voller Testlauf, Server- und Client-Tests parallel) reichte
// das nicht, und Belege, propertyCreate und AiSettings scheiterten gelegentlich, ohne dass etwas
// falsch war. src/vitestSetup.ts setzt sie für alle Tests herauf.
import { describe, expect, test } from 'vitest'
import { getConfig } from '@testing-library/react'

describe('Testumgebung', () => {
  test('findBy und waitFor warten fünf Sekunden', () => {
    expect(getConfig().asyncUtilTimeout).toBe(5000)
  })
})
