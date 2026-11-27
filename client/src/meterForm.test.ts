// Die Einheit eines Zählers folgt seiner Sparte (#142): Ein Wärmezähler, bei dem niemand die
// Einheit geändert hat, zeigte „m³“.
import { describe, expect, test } from 'vitest'
import { hcaFieldsBody } from './hcaForm'
import { SCALE_MISSING_WITH_FACTOR, FREE_UNIT_PLACEHOLDER, HEATING_ROLE_HELP, asksCalibration, asksRemote, asksScope, calibrationSuggestion, defaultMeterUnit, emptyMeterForm, heatingRoleLabel, heatingRoleOptions, houseLabel, meterBody, meterDeleteMessage, meterPlantId, meterScaleHint, scaleRequired, meterToForm, meterTypeChoices, meterTypeHint, meterTypeOptionLabel, meterUnitChoices, meterUnitHint, meterUnitOptions, oldEndText, readingDigits, readingText, withMeterType } from './meterForm'

test('Vorgabe der Einheit je Sparte: Wasser m³, Wärme und Strom kWh, Sonstiges leer', () => {
  expect(defaultMeterUnit('kaltwasser')).toBe('m³')
  expect(defaultMeterUnit('waerme')).toBe('kWh')
  expect(defaultMeterUnit('strom')).toBe('kWh')
  expect(defaultMeterUnit('sonstig')).toBe('')
})

test('Sparte wechseln: die Vorgabe wandert mit, eine eigene Einheit bleibt', () => {
  const form = { ...emptyMeterForm(), name: 'Wärme EG' }
  expect(withMeterType(form, 'waerme')).toMatchObject({ type: 'waerme', unit: 'kWh' })
  expect(withMeterType({ ...form, unit: '' }, 'waerme')).toMatchObject({ unit: 'kWh' })
  expect(withMeterType({ ...form, unit: 'MWh' }, 'waerme')).toMatchObject({ type: 'waerme', unit: 'MWh' })
  expect(withMeterType({ ...form, type: 'waerme', unit: 'kWh' }, 'sonstig')).toMatchObject({ unit: '' })
})

test('#342: Sparte wechseln bei einem neuen Zähler: die Vorgabe wandert mit; eine Einheit, die die neue Sparte nicht kennt, wird „Bitte wählen“ (S6)', () => {
  const form = { ...emptyMeterForm(), name: 'Zähler', type: 'waerme' as const, unit: 'MWh' }
  expect(withMeterType(form, 'strom')).toMatchObject({ type: 'strom', unit: 'MWh' })
  const ww = withMeterType(form, 'warmwasser')
  expect(ww).toMatchObject({ type: 'warmwasser', unit: '', unitDropped: 'MWh' })
  expect(meterUnitHint(ww)).toBe('„MWh“ ist für Warmwasser keine Einheit. Bitte wählen Sie die Einheit, die der Zähler zeigt.')
  expect(meterBody({ ...ww, unitId: 'eg' }, null)).toMatchObject({ error: 'Bitte wählen Sie die Einheit, die der Zähler zeigt.' })
  expect(withMeterType({ ...form, type: 'kaltwasser', unit: 'l' }, 'warmwasser')).toMatchObject({ unit: 'l' })
  // Die Vorgabe der bisherigen Sparte wandert mit (#142).
  expect(withMeterType(emptyMeterForm(), 'waerme')).toMatchObject({ unit: 'kWh', unitDropped: '' })
})

test('#342 S6: Sparte wechseln bei einem bestehenden Zähler: eine unmögliche Einheit bleibt nicht still stehen', () => {
  const bad = meterToForm({ id: 'm1', propertyId: 'p', name: 'Bad', unitId: 'eg', type: 'warmwasser', unit: 'l' })
  const w = withMeterType(bad, 'waerme')
  expect(w).toMatchObject({ type: 'waerme', unit: '', unitDropped: 'l' })
  expect(meterUnitHint(w)).toBe('„l“ ist für Wärme keine Einheit. Bitte wählen Sie die Einheit, die der Zähler zeigt.')
  expect(meterBody(w, null)).toMatchObject({ error: 'Bitte wählen Sie die Einheit, die der Zähler zeigt.' })
  expect(meterBody({ ...w, unit: 'kWh' }, null)).toMatchObject({ body: { type: 'waerme', unit: 'kWh' } })
  // Eine Einheit, die die neue Sparte kennt, bleibt.
  expect(withMeterType(meterToForm({ id: 'm2', propertyId: 'p', name: 'Strom', unitId: 'eg', type: 'strom', unit: 'MWh' }), 'waerme')).toMatchObject({ unit: 'MWh', unitDropped: '' })
})

test('#342 S2: ein gespeicherter Zähler ohne Einheit bekommt keine Vorgabe; gespeichert wird nur, was gewählt ist', () => {
  const leer = meterToForm({ id: 'm1', propertyId: 'p', name: 'Wärme alt', unitId: 'eg', type: 'waerme', unit: '' })
  expect(leer.unit).toBe('')
  expect(meterUnitHint(leer)).toBe('Für diesen Zähler ist keine Einheit gespeichert. Bitte wählen Sie die Einheit, die er zeigt.')
  // Umbenennen ohne Wahl: die Einheit bleibt leer, sie wird nicht still „kWh“.
  expect(meterBody({ ...leer, name: 'Wärme Keller' }, null)).toMatchObject({ body: { name: 'Wärme Keller', unit: '' } })
  expect(meterBody({ ...leer, unit: 'MWh' }, null)).toMatchObject({ body: { unit: 'MWh' } })
  // S-N1: nach einem Spartenwechsel nur mit gewählter Einheit.
  expect(meterBody(withMeterType(leer, 'strom'), null)).toMatchObject({ error: 'Bitte wählen Sie die Einheit, die der Zähler zeigt.' })
  // Ein neuer Zähler bekommt weiter die Vorgabe der Sparte, und ohne Einheit lässt er sich nicht speichern.
  expect(emptyMeterForm().unit).toBe('m³')
  expect(meterBody({ ...emptyMeterForm(), name: 'Neu', unitId: 'eg', type: 'waerme', unit: '' }, null)).toMatchObject({ error: 'Bitte wählen Sie die Einheit, die der Zähler zeigt.' })
  expect(meterUnitHint({ ...emptyMeterForm(), type: 'waerme', unit: 'kWh' })).toBeNull()
})

test('#342: die Einheit ist bei bekannten Sparten eine Auswahl; die Auswahl zeigt, was gespeichert ist', () => {
  const stored = { id: 'm1', propertyId: 'p', name: 'Küche', unitId: 'eg', type: 'kaltwasser' as const, unit: 'm3' }
  // Eine andere Schreibweise derselben Einheit wird die bekannte, damit der Wert in der Auswahl steht.
  const form = meterToForm(stored)
  expect(form.unit).toBe('m³')
  expect(meterUnitOptions(form.type, form.unit)).toContain(form.unit)
  // Eine unbekannte gespeicherte Einheit steht zusätzlich in der Auswahl.
  const odd = meterToForm({ ...stored, type: 'waerme', unit: 'm³' })
  expect(meterUnitOptions(odd.type, odd.unit)).toEqual(['kWh', 'MWh', 'GJ', 'm³'])
  // Sonstiges bleibt Freitext.
  expect(meterUnitOptions('sonstig', 'Stück')).toEqual([])
})

test('#342: beim Speichern wird eine neue oder geänderte unbekannte Einheit abgelehnt, eine gespeicherte unveränderte nicht', () => {
  const neu = { ...emptyMeterForm(), name: 'Wärme EG', unitId: 'eg', type: 'waerme' as const, unit: 'm³' }
  expect(meterBody(neu, null)).toMatchObject({ error: expect.stringMatching(/Die Einheit „m³“ kennt Mietfuchs für diese Sparte nicht/) })
  expect(meterBody({ ...neu, unit: 'MWh' }, null)).toMatchObject({ body: { unit: 'MWh' } })
  // Gespeichert vor #342 und unverändert mitgeschickt: hindert das Speichern einer anderen Angabe nicht.
  const alt = meterToForm({ id: 'm1', propertyId: 'p', name: 'Wärme EG', unitId: 'eg', type: 'waerme', unit: 'm³' })
  expect(meterBody({ ...alt, name: 'Wärme Erdgeschoss' }, null)).toMatchObject({ body: { name: 'Wärme Erdgeschoss', unit: 'm³' } })
  // Sonstiges: jeder Text.
  expect(meterBody({ ...neu, type: 'sonstig', unit: 'Stück' }, null)).toMatchObject({ body: { unit: 'Stück' } })
})

test('Zählerwechsel: ein fehlender Endstand heißt „fehlt“, eine 0 bleibt eine 0', () => {
  expect(oldEndText(null)).toBe('fehlt')
  expect(oldEndText(undefined)).toBe('fehlt')
  expect(oldEndText(0)).toBe('0')
  expect(oldEndText(1234.5)).toBe('1.234,5')
})

test('ein bestehender Zähler behält beim Wechsel der Sparte seine Einheit, wenn die neue Sparte sie kennt (Durchsicht zu #142, zu #342 S6)', () => {
  const vorhanden = { ...emptyMeterForm(), id: 'm1', name: 'Zähler' }
  expect(withMeterType(vorhanden, 'warmwasser')).toMatchObject({ type: 'warmwasser', unit: 'm³' })
  // m³ ist bei Wärme keine Einheit: Seit #342 steht die Auswahl dann auf „Bitte wählen“ statt still auf m³.
  expect(withMeterType(vorhanden, 'waerme')).toMatchObject({ type: 'waerme', unit: '', unitDropped: 'm³' })
})

test('Warmwasser in m³, Heizkostenverteiler in Einheiten (Heizung PR 4)', () => {
  expect(defaultMeterUnit('warmwasser')).toBe('m³')
  expect(defaultMeterUnit('hkv')).toBe('Einheiten')
})

test('Zähler der Heizanlage: nur ohne Wohnung und mit Anlage; Fernablesbarkeit nur bei Geräten nach § 5 HeizkostenV', () => {
  const speicher = { ...emptyMeterForm(), name: 'Speicher', type: 'waerme' as const, unit: 'kWh', heatingRole: 'dhwHeat' as const, remote: 'no' as const, installedOn: '2022-03-01' }
  expect(meterBody(speicher, 'hp1')).toEqual({
    body: { name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01', hcaScale: null, ratingFactor: null, calibratedUntil: null, scope: null },
  })
  // Ohne Anlage im Objekt bleibt es ein Hauptzähler, und dann fragt das Formular nicht nach § 5. Die
  // Felder fehlen dann im Rumpf, damit eine gespeicherte Angabe bleibt (Durchsicht von #230, M1).
  const ohneAnlage = meterBody(speicher, null)
  expect(ohneAnlage).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
  expect('body' in ohneAnlage && Object.hasOwn(ohneAnlage.body, 'remoteReadable')).toBe(false)
  // Das Einbaudatum steht bei jedem Zähler im Formular und geht deshalb immer mit.
  expect(ohneAnlage).toMatchObject({ body: { installedOn: '2022-03-01' } })
  expect(meterBody({ ...emptyMeterForm(), name: 'Wasser EG', unitId: 'eg', installedOn: '2025-06-30' }, null)).toMatchObject({ body: { type: 'kaltwasser', installedOn: '2025-06-30' } })
  expect(meterBody({ ...emptyMeterForm(), name: 'Wasser EG', unitId: 'eg' }, null)).toMatchObject({ body: { installedOn: null } })
  const hkvOhneAnlage = meterBody({ ...emptyMeterForm(), name: 'HKV', unitId: 'eg', type: 'hkv', unit: 'Einheiten', remote: 'no', hca: { scale: 'product', factor: '' } }, null)
  expect('body' in hkvOhneAnlage && Object.hasOwn(hkvOhneAnlage.body, 'remoteReadable')).toBe(false)
  expect(asksRemote({ ...emptyMeterForm(), unitId: 'eg', type: 'hkv' }, false)).toBe(false)
  expect(asksRemote({ ...emptyMeterForm(), unitId: 'eg', type: 'hkv' }, true)).toBe(true)
  // Der Gaszähler gehört dem Versorger: Rolle ja, Fernablesbarkeit nein.
  expect(meterBody({ ...speicher, name: 'Gas', type: 'sonstig', heatingRole: 'supply' }, 'hp1'))
    .toMatchObject({ body: { heatingPlantId: 'hp1', heatingRole: 'supply', remoteReadable: null, installedOn: '2022-03-01' } })
  // An einer Wohnung: Kaltwasser ohne, Heizkostenverteiler mit Fernablesbarkeit.
  expect(meterBody({ ...emptyMeterForm(), name: 'Küche', unitId: 'eg', remote: 'yes' }, 'hp1')).toMatchObject({ body: { unitId: 'eg', heatingPlantId: null, remoteReadable: null } })
  const hkv = { ...emptyMeterForm(), name: 'HKV Bad', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten', remote: 'yes' as const, hca: { scale: 'product' as const, factor: '' } }
  expect(meterBody(hkv, 'hp1')).toMatchObject({ body: { remoteReadable: true, heatingPlantId: null } })
  expect(meterBody({ ...hkv, unitId: '' }, 'hp1')).toMatchObject({ error: expect.stringMatching(/Heizkörper/) })
  expect(meterBody({ ...hkv, name: ' ' }, 'hp1')).toMatchObject({ error: 'Bitte einen Namen für den Zähler angeben.' })
})

test('Bearbeiten: was gespeichert ist, steht wieder im Formular', () => {
  expect(meterToForm({
    id: 'm1', propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
    heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
  })).toEqual({ id: 'm1', name: 'Speicher', unitId: '', type: 'waerme', meterNumber: '', unit: 'kWh', keptUnit: 'kWh', unitDropped: '', keptType: 'waerme', heatingRole: 'dhwHeat', keptRole: 'dhwHeat', remote: 'no', installedOn: '2022-03-01', heatingPlantId: 'hp1', hca: { scale: '', factor: '' }, keptScale: '', calibratedUntil: '', scope: 'property' })
})

// Sichtprüfung E19: „Gehört zur Heizanlage?“ stand auch bei Kaltwasser. Ein Wasserzähler ist weder
// Versorgungszähler noch Wärmezähler der Anlage; der Server verlangt für die Wärmezähler die Sparte
// „Wärme“. Gefragt wird nur, wo eine Rolle möglich ist, und nur mit den passenden Rollen.
test('die Rolle an der Heizanlage nur, wo sie möglich ist', () => {
  const haus = { ...emptyMeterForm(), name: 'Haus' }
  expect(heatingRoleOptions(haus, true)).toEqual([])
  expect(heatingRoleOptions({ ...haus, type: 'warmwasser' }, true)).toEqual([])
  expect(heatingRoleOptions({ ...haus, type: 'waerme' }, true)).toEqual(['supply', 'dhwHeat', 'totalHeat'])
  expect(heatingRoleOptions({ ...haus, type: 'sonstig' }, true)).toEqual(['supply'])
  expect(heatingRoleOptions({ ...haus, type: 'strom' }, true)).toEqual(['supply'])
  expect(heatingRoleOptions({ ...haus, type: 'waerme' }, false)).toEqual([])
  expect(heatingRoleOptions({ ...haus, type: 'waerme', unitId: 'eg' }, true)).toEqual([])
  // Eine stehengebliebene Rolle nach dem Wechsel auf Kaltwasser wird nicht gespeichert.
  expect(meterBody({ ...haus, heatingRole: 'supply' }, 'hp1')).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
  expect(meterBody({ ...haus, type: 'sonstig', heatingRole: 'dhwHeat' }, 'hp1')).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
})

// Durchsicht M1: Eine gespeicherte Rolle, die das Auswahlfeld für die Sparte nicht mehr anbietet
// (etwa ein Warmwasserzähler der Anlage als Versorgungszähler), fiel beim nächsten Speichern weg,
// auch bei bloßer Umbenennung; die Berechnung las den Zähler dann als Hauptzähler. Sie bleibt und
// steht als eigene Option da; sie fällt nur bei einem Spartenwechsel oder mit „Nein“.
test('eine gespeicherte Rolle bleibt beim Speichern, bis die Sparte wechselt oder „Nein“ gewählt wird', () => {
  const stored = meterToForm({ id: 'm9', propertyId: 'objekt-1', name: 'WW Speicher', unitId: null, type: 'warmwasser', unit: 'm³', heatingPlantId: 'p1', heatingRole: 'supply' })
  expect(meterBody({ ...stored, name: 'neu' }, 'p1')).toMatchObject({ body: { heatingPlantId: 'p1', heatingRole: 'supply' } })
  expect(heatingRoleOptions(stored, true)).toEqual(['supply'])
  expect(heatingRoleLabel(stored, 'supply')).toBe('bisher: Versorgungszähler der Heizanlage (etwa der Gaszähler)')
  expect(meterBody({ ...stored, heatingRole: '' }, 'p1')).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
  const kalt = withMeterType(stored, 'kaltwasser')
  expect(heatingRoleOptions(kalt, true)).toEqual([])
  expect(meterBody(kalt, 'p1')).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
  // Eine Rolle, die die Sparte ohnehin anbietet, heißt ohne „bisher“.
  const gas = meterToForm({ id: 'g', propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'p1', heatingRole: 'supply' })
  expect(heatingRoleLabel(gas, 'supply')).toBe('Versorgungszähler der Heizanlage (etwa der Gaszähler)')
})

describe('Zähler an einer von mehreren Heizanlagen (Heizung PR 9)', () => {
  const A = { id: 'hp1' }
  const B = { id: 'hp2' }
  const form = { ...emptyMeterForm(), name: 'Gaszähler', type: 'sonstig' as const, heatingRole: 'supply' as const }
  test('eine Anlage: diese', () => expect(meterPlantId(form, [A])).toEqual({ plantId: 'hp1' }))
  test('zwei Anlagen: die gewählte, ohne Wahl ein Satz', () => {
    expect(meterPlantId({ ...form, heatingPlantId: 'hp2' }, [A, B])).toEqual({ plantId: 'hp2' })
    expect(meterPlantId(form, [A, B])).toMatchObject({ error: 'Bitte wählen Sie die Heizanlage, zu der der Zähler gehört.' })
    expect(meterPlantId({ ...form, heatingRole: '' }, [A, B])).toEqual({ plantId: null })
  })
  test('ein gespeicherter Zähler bringt seine Anlage mit', () => {
    expect(meterToForm({ id: 'm', propertyId: 'objekt-1', name: 'Gas', unitId: null, type: 'sonstig', unit: 'm³', heatingPlantId: 'hp2', heatingRole: 'supply' }).heatingPlantId).toBe('hp2')
  })
})

test('Heizkostenverteiler (Heizung PR 12): Skala und Faktor im Rumpf, beim Bearbeiten wieder im Formular, bei anderer Sparte leer', () => {
  const hkv = { ...emptyMeterForm(), name: 'Wohnzimmer', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten', hca: { scale: 'unit' as const, factor: '1,25' } }
  expect(meterBody(hkv, null)).toMatchObject({ body: { hcaScale: 'unit', ratingFactor: 1.25 } })
  expect(meterBody({ ...hkv, hca: { scale: 'unit', factor: '0' } }, null)).toMatchObject({ error: 'Der Bewertungsfaktor ist eine Zahl über 0, etwa 0,8 oder 1,25.' })
  // Wechselt die Sparte, gehen Skala und Faktor als leer mit, sonst lehnte der Server ab.
  expect(meterBody({ ...hkv, type: 'waerme', unit: 'kWh' }, null)).toMatchObject({ body: { hcaScale: null, ratingFactor: null } })
  expect(meterToForm({ id: 'h1', propertyId: 'objekt-1', name: 'Wohnzimmer', unitId: 'eg', type: 'hkv', unit: 'Einheiten', hcaScale: 'unit', ratingFactor: 0.875 }).hca).toEqual({ scale: 'unit', factor: '0,875' })
})

describe('Eichfrist (Heizung PR 21, #98)', () => {
  const vierstellig = 'Bitte tragen Sie das Eichjahr vierstellig ein, so wie es der Messdienst oder der Eichschein nennt, oder lassen Sie das Feld leer.'

  test('Eichjahr ins Formular und zurück, auch ohne Heizanlage; leer ist null; beim Heizkostenverteiler nie', () => {
    const m = { id: 'm1', propertyId: 'objekt-1', name: 'Kaltwasser', unitId: null, type: 'kaltwasser' as const, unit: 'm³', calibratedUntil: 2028 }
    const form = meterToForm(m)
    expect(form.calibratedUntil).toBe('2028')
    const r = meterBody(form, null)
    if ('error' in r) throw new Error(r.error)
    expect(r.body.calibratedUntil).toBe(2028)
    // Mit Heizanlage ebenso (Prüfung des Plans, S11: nicht nur im Teil für die Heizanlage).
    const mitAnlage = meterBody(form, 'hp1')
    expect('body' in mitAnlage && mitAnlage.body.calibratedUntil).toBe(2028)
    const leer = meterBody({ ...form, calibratedUntil: ' ' }, null)
    expect('body' in leer && leer.body.calibratedUntil).toBe(null)
    expect(meterToForm({ ...m, calibratedUntil: null }).calibratedUntil).toBe('')
    expect(emptyMeterForm().calibratedUntil).toBe('')
    const hkv = meterBody({ ...emptyMeterForm(), name: 'HKV', type: 'hkv', unitId: 'u1', calibratedUntil: '2028', hca: { scale: 'product', factor: '' } }, null)
    expect('body' in hkv && hkv.body.calibratedUntil).toBe(null)
    expect(asksCalibration({ type: 'hkv' })).toBe(false)
    for (const type of ['kaltwasser', 'warmwasser', 'waerme', 'strom', 'sonstig'] as const) expect(asksCalibration({ type })).toBe(true)
  })

  test('Eichjahr, das keine vierstellige Jahreszahl ist, ergibt einen Satz', () => {
    for (const bad of ['28', '2028,5', 'M22', '20280']) {
      expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: bad }, null)).toMatchObject({ error: vierstellig })
    }
    // Vierstellig, aber außerhalb der Grenzen: kein „vierstellig“ (Durchsicht von #404)
    expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: '1899' }, null)).toMatchObject({ error: 'Das Eichjahr 1899 liegt außerhalb von 1900 bis 2100. Bitte prüfen Sie es am Eichschein, oder lassen Sie das Feld leer.' })
    expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: '0999' }, null)).toMatchObject({ error: 'Das Eichjahr 0999 liegt außerhalb von 1900 bis 2100. Bitte prüfen Sie es am Eichschein, oder lassen Sie das Feld leer.' })
  })

  test('Vorschlag aus der Jahreszahl auf dem Zähler: Jahreszahl plus Frist aus dem Register', () => {
    expect(calibrationSuggestion('warmwasser', '2022')).toEqual({ year: 2028, text: 'Vorschlag: geeicht bis Ende 2028 (Jahreszahl auf dem Zähler 2022, Eichfrist 6 Jahre).' })
    expect(calibrationSuggestion('kaltwasser', ' 2025 ')).toEqual({ year: 2031, text: 'Vorschlag: geeicht bis Ende 2031 (Jahreszahl auf dem Zähler 2025, Eichfrist 6 Jahre).' })
    expect(calibrationSuggestion('kaltwasser', '2018')).toEqual({ year: 2024, text: 'Vorschlag: geeicht bis Ende 2024 (Jahreszahl auf dem Zähler 2018, Eichfrist 6 Jahre).' })
    // Warmwasser 2015: fünf Jahre, Ablauf Ende 2020, vor dem Inkrafttreten der sechs Jahre.
    expect(calibrationSuggestion('warmwasser', '2015')).toEqual({ year: 2020, text: 'Vorschlag: geeicht bis Ende 2020 (Jahreszahl auf dem Zähler 2015, Eichfrist 5 Jahre).' })
  })

  test('Review Focus 5 nach Vorgabe R21-1: eine am 03.11.2021 laufende Frist mit sechs Jahren, als Auslegung benannt', () => {
    const s = calibrationSuggestion('waerme', '2016')
    if (!('year' in s)) throw new Error('kein Vorschlag')
    expect(s.year).toBe(2022)
    expect(s.text).toMatch(/^Vorschlag: geeicht bis Ende 2022 \(Jahreszahl auf dem Zähler 2016\)\./)
    expect(s.text).toMatch(/Eichfrist von 5 Jahren lief am 03\.11\.2021 noch, als sie auf 6 Jahre stieg/)
    expect(s.text).toContain('Die Änderungsverordnung vom 26.10.2021 enthält keine Übergangsregel. Mietfuchs wendet die Frist von 6 Jahren auch auf Fristen an, die am 03.11.2021 noch liefen; eine schon abgelaufene Frist lebt nicht wieder auf. Das ist eine Auslegung.')
    expect(s.text).not.toMatch(/Eichbehörden|Messdienste/)
    expect(s.text).not.toMatch(/gekennzeichnet oder geeicht, galten/)
    const im = calibrationSuggestion('warmwasser', '2021')
    expect('year' in im && im.year).toBe(2027)
    expect('text' in im && im.text).toMatch(/Wurde der Zähler nach dem 02\.11\.2021 gekennzeichnet oder geeicht, galten von Anfang an 6 Jahre/)
  })

  test('Kein Vorschlag vor der MessEV, für Gas, Strom und Sonstiges und bei unlesbarer Jahreszahl', () => {
    const eo = calibrationSuggestion('kaltwasser', '2014')
    expect('reason' in eo && eo.reason).toMatch(/vor 2015.*Eichordnung.*Messdienst oder der Eichschein/s)
    const strom = calibrationSuggestion('strom', '2024')
    expect('reason' in strom && strom.reason).toMatch(/hängt von der Bauart ab/)
    expect('reason' in calibrationSuggestion('sonstig', '2024')).toBe(true)
    expect(calibrationSuggestion('waerme', '22')).toEqual({ reason: 'Bitte nennen Sie die Jahreszahl vierstellig, wie auf dem Zähler.' })
  })
})

// #346, Schritt 3: Jede Meldung nennt ihr Feld, damit sie am Feld steht und die Sammelmeldung dorthin führt.
test('Meldungen des Zählerformulars nennen ihr Feld und eine kurze Fassung', () => {
  expect(meterBody({ ...emptyMeterForm(), name: ' ' }, null)).toMatchObject({ field: 'name', short: 'Name fehlt' })
  expect(meterBody({ ...emptyMeterForm(), name: 'HKV', type: 'hkv', unitId: '' }, null)).toMatchObject({ field: 'unitId' })
  expect(meterBody({ ...emptyMeterForm(), name: 'W', unitId: 'eg', type: 'waerme', unit: '' }, null)).toMatchObject({ field: 'unit', short: 'Einheit fehlt' })
  expect(meterBody({ ...emptyMeterForm(), name: 'K', calibratedUntil: '22' }, null)).toMatchObject({ field: 'calibratedUntil' })
  expect(meterPlantId({ unitId: '', heatingRole: 'supply', heatingPlantId: '' }, [{ id: 'a' }, { id: 'b' }])).toMatchObject({ field: 'heatingPlantId' })
})

// N4 aus #341: In der Liste eines Zählers haben alle Stände gleich viele Nachkommastellen, so viele wie der
// genaueste (höchstens drei); vorher stand „316“ neben „332,7“.
test('Ablesungen eines Zählers stehen mit gleich vielen Nachkommastellen', () => {
  const digits = readingDigits([{ value: 316 }, { value: 332.7, oldEndValue: 12 }])
  expect(digits).toBe(1)
  expect(readingText(316, digits)).toBe('316,0')
  expect(readingText(1387.25, 2)).toBe('1.387,25')
  expect(oldEndText(12, digits)).toBe('12,0')
  expect(oldEndText(null, digits)).toBe('fehlt')
  expect(readingDigits([{ value: 316 }, { value: 1387 }])).toBe(0)
  expect(readingDigits([{ value: 0.12345 }])).toBe(3)
})

test('#98: „Misst dieser Zähler das ganze Haus oder einen Teil?“ nur bei einem Zähler ohne Wohnung und ohne Heizanlage', () => {
  const house = { ...emptyMeterForm(), name: 'Allgemeinstrom', type: 'strom' as const, unit: 'kWh' }
  expect(asksScope(house)).toBe(true)
  expect(asksScope({ ...house, unitId: 'eg' })).toBe(false)
  expect(asksScope({ ...house, heatingRole: 'supply' })).toBe(false)
  expect(asksScope({ ...house, type: 'hkv' })).toBe(false)
  // Vorgabe wie bisher: das ganze Haus; gesendet wird `null`, das den Hauptzähler meint.
  expect(emptyMeterForm().scope).toBe('property')
  expect(meterBody(house, null)).toMatchObject({ body: { scope: null } })
  expect(meterBody({ ...house, scope: 'common' }, null)).toMatchObject({ body: { scope: 'common' } })
  // An einer Wohnung oder an der Heizanlage nie `common`, sonst lehnte der Server ab.
  expect(meterBody({ ...house, scope: 'common', unitId: 'eg' }, null)).toMatchObject({ body: { scope: null } })
  expect(meterBody({ ...house, scope: 'common', heatingRole: 'supply' }, 'pl')).toMatchObject({ body: { scope: null } })
  // Gespeichert und wieder geöffnet: angezeigt wie gespeichert.
  expect(meterToForm({ id: 'm', propertyId: 'p', name: 'WG', unitId: null, type: 'kaltwasser', unit: 'm³', scope: 'common' }).scope).toBe('common')
  expect(meterToForm({ id: 'm', propertyId: 'p', name: 'Haupt', unitId: null, type: 'kaltwasser', unit: 'm³' }).scope).toBe('property')
})

test('#98 Durchsicht: die Frage nach dem Teil des Hauses nur bei Kaltwasser, Strom und „Sonstiges“', () => {
  const house = { ...emptyMeterForm(), name: 'Haus' }
  expect(asksScope({ ...house, type: 'kaltwasser' })).toBe(true)
  expect(asksScope({ ...house, type: 'sonstig' })).toBe(true)
  expect(asksScope({ ...house, type: 'warmwasser' })).toBe(false)
  expect(asksScope({ ...house, type: 'waerme' })).toBe(false)
  expect(meterBody({ ...house, type: 'waerme', unit: 'kWh' }, null)).toMatchObject({ body: { scope: null } })
  // Ein gespeichertes `common` bleibt sichtbar und wird so gesendet (angezeigt gleich gespeichert).
  expect(asksScope({ ...house, type: 'waerme', scope: 'common' })).toBe(true)
})

// Zimmer einer Wohnung (#573): An einer Wohnung mit Zimmern hängen nur Kaltwasser, Strom und Sonstiges.
describe('Zähler an einer Wohnung mit Zimmern', () => {
  const unit = (id: string, parentUnitId?: string) => ({ id, propertyId: 'p', name: id, areaM2: 20, participates: true, parentUnitId })
  const units = [unit('wg'), unit('z1', 'wg'), unit('eg')]

  test('Sparten: an der Wohnung mit Zimmern nur die drei, sonst alle', () => {
    expect(meterTypeChoices('wg', units, 'kaltwasser')).toEqual(['kaltwasser', 'strom', 'sonstig'])
    expect(meterTypeChoices('eg', units, 'kaltwasser')).toEqual(['kaltwasser', 'warmwasser', 'strom', 'waerme', 'hkv', 'sonstig'])
    expect(meterTypeChoices('', units, 'waerme')).toHaveLength(6)
    expect(meterTypeChoices('z1', units, 'hkv')).toHaveLength(6)
  })

  test('die gespeicherte Sparte steht immer darin, auch wenn der Server sie ablehnt', () => {
    expect(meterTypeChoices('wg', units, 'waerme')).toContain('waerme')
  })

  test('Zuordnung: Wärme, Warmwasser und Heizkostenverteiler bieten die Wohnung mit Zimmern nicht an', () => {
    expect(meterUnitChoices(units, 'waerme', '').map((u) => u.id)).toEqual(['z1', 'eg'])
    expect(meterUnitChoices(units, 'hkv', '').map((u) => u.id)).toEqual(['z1', 'eg'])
    expect(meterUnitChoices(units, 'kaltwasser', '').map((u) => u.id)).toEqual(['wg', 'z1', 'eg'])
    // die gewählte bleibt, damit die Auswahl zeigt, was gespeichert ist
    expect(meterUnitChoices(units, 'waerme', 'wg').map((u) => u.id)).toEqual(['wg', 'z1', 'eg'])
  })
})

// Browserprüfung 0.16.0 (S3): „ohne Wohnung“ heißt in Zuordnung und Liste gleich; ein Teil des Hauses ist kein Hauptzähler.
test('houseLabel: Hauptzähler oder Teil des Hauses, wie gesendet würde', () => {
  const house = { ...emptyMeterForm(), name: 'Garten', type: 'kaltwasser' as const, unit: 'm³' }
  expect(houseLabel(house)).toBe('Haus (Hauptzähler)')
  expect(houseLabel({ ...house, scope: 'common' })).toBe('Haus (Teil des Hauses)')
  // Mit gewählter Wohnung gilt die Beschriftung der Option „ohne Wohnung“, also wie mit leerer Zuordnung.
  const atUnit = { ...house, scope: 'common' as const, unitId: 'eg' }
  expect(houseLabel(atUnit)).toBe('Haus (Teil des Hauses)')
  // An der Heizanlage wird `common` nicht gesendet.
  expect(houseLabel({ ...house, scope: 'common', heatingRole: 'supply' })).toBe('Haus (Hauptzähler)')
})

test('Löschfrage eines Zählers: wie viele Ablesungen aus welchen Jahren, und dass der Verlauf es zurücknimmt', () => {
  const undo = 'Auf der Seite „Verlauf“ lässt sich das Löschen zurücknehmen: gleich danach für sich allein, später nur zusammen mit allem, was Sie seither geändert haben, längstens zwölf Monate lang und nicht über den Abschluss einer Abrechnung, ein eingespieltes Backup oder ein Update von Mietfuchs hinweg.'
  expect(meterDeleteMessage(['2023-12-31', '2025-12-31', '2024-12-31'])).toBe(
    `Mit dem Zähler werden 3 Ablesungen aus den Jahren 2023 bis 2025 gelöscht. Der Verbrauch dieser Zeit lässt sich danach nicht mehr berechnen; abgeschlossene Abrechnungen bleiben, wie sie sind. ${undo}`,
  )
  expect(meterDeleteMessage(['2025-01-01', '2025-12-31'])).toMatch(/^Mit dem Zähler werden 2 Ablesungen aus dem Jahr 2025 gelöscht\. /)
  expect(meterDeleteMessage(['2025-01-01'])).toMatch(/^Mit dem Zähler wird 1 Ablesung aus dem Jahr 2025 gelöscht\. /)
  expect(meterDeleteMessage([])).toBe(`Der Zähler hat keine Ablesungen. ${undo}`)
  // Ein krummes Datum im Bestand ergibt kein Jahr „1.1.“: Gezählt wird die Ablesung, genannt werden nur lesbare Jahre.
  expect(meterDeleteMessage(['1.1.2024', '2025-12-31'])).toMatch(/^Mit dem Zähler werden 2 Ablesungen aus dem Jahr 2025 gelöscht\. /)
  expect(meterDeleteMessage(['1.1.2024'])).toMatch(/^Mit dem Zähler wird 1 Ablesung gelöscht\. /)
})

// #705: Ein Gaszähler zeigt m³ und gehört in die Sparte „Sonstiges“; unter „Wärme“ gibt es die Einheit nicht.
test('#705: die Auswahl der Sparte nennt bei „Sonstiges“ den Gaszähler, und Wärme und Sonstiges sagen, wohin der Gaszähler gehört', () => {
  expect(meterTypeOptionLabel('sonstig')).toBe('Sonstiges (z. B. Gaszähler)')
  expect(meterTypeOptionLabel('waerme')).toBe('Wärme')
  expect(meterTypeOptionLabel('kaltwasser')).toBe('Kaltwasser')
  expect(meterTypeHint('waerme')).toBe('Für Wärmezähler, die kWh, MWh oder GJ zeigen. Ein Gaszähler zeigt m³ und gehört in die Sparte „Sonstiges“.')
  expect(meterTypeHint('sonstig')).toBe('Auch für den Gaszähler der Heizung: Tragen Sie als Einheit ein, was der Zähler zeigt, etwa m³. Für die Heizkosten zählt er erst als Versorgungszähler einer Heizanlage, die Sie unter Stammdaten → Heizung anlegen.')
  for (const t of ['kaltwasser', 'warmwasser', 'strom', 'hkv'] as const) expect(meterTypeHint(t)).toBeNull()
})

// Unabhängige Prüfung von #705: Unter „Wärme“ nannte die Rolle den Gaszähler als Beispiel, direkt unter dem Satz, dass
// er dort nicht hingehört; und „Nein, wenn er den Verbrauch des ganzen Hauses misst“ las ein Laie als seinen Gaszähler.
test('#705: die Rolle „Versorgungszähler“ nennt je Sparte ihr Beispiel, und die Hilfe schickt den Gaszähler nicht zu „Nein“', () => {
  const form = { ...emptyMeterForm(), unitId: '' }
  expect(heatingRoleLabel({ ...form, type: 'sonstig' }, 'supply')).toBe('Versorgungszähler der Heizanlage (etwa der Gaszähler)')
  expect(heatingRoleLabel({ ...form, type: 'waerme' }, 'supply')).toBe('Versorgungszähler der Heizanlage (etwa der Fernwärmezähler)')
  expect(heatingRoleLabel({ ...form, type: 'strom' }, 'supply')).toBe('Versorgungszähler der Heizanlage (etwa der Stromzähler der Wärmepumpe)')
  expect(HEATING_ROLE_HELP).toBe('Ein Zähler der Heizanlage zählt nicht als Hauptzähler des Hauses; Mietfuchs ordnet ihn den Heizkosten zu. Wählen Sie „Nein“, wenn er nicht die Heizanlage versorgt.')
  expect(FREE_UNIT_PLACEHOLDER).toBe('z. B. m³')
})

// #723: Ohne Skala verteilt die eigene Heizkostenabrechnung nichts (`heating.hca-factor-missing`); das Formular ließ
// das Gerät trotzdem ohne Wahl anlegen.
describe('#723: Skala des Heizkostenverteilers ist Pflicht', () => {
  const neu = { ...emptyMeterForm(), name: 'Wohnzimmer', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten' }
  test('neues Gerät ohne Skala: Meldung am Feld, mit Skala gespeichert', () => {
    expect(scaleRequired(neu)).toBe(true)
    const ohne = meterBody(neu, null)
    expect(ohne).toMatchObject({ error: 'Bitte wählen Sie die Skala des Heizkostenverteilers: Einheitsskala oder Produktskala.', field: 'hcaScale', short: 'Skala fehlt' })
    expect(meterBody({ ...neu, hca: { scale: 'product', factor: '' } }, null)).toMatchObject({ body: { hcaScale: 'product', ratingFactor: null } })
    expect(meterBody({ ...neu, hca: { scale: 'unit', factor: '1,25' } }, null)).toMatchObject({ body: { hcaScale: 'unit', ratingFactor: 1.25 } })
    // Alle Angaben auf einmal: Name und Skala.
    const beide = meterBody({ ...neu, name: '' }, null)
    expect('problems' in beide && beide.problems.map((x) => x.field)).toEqual(['name', 'hcaScale'])
    expect(meterScaleHint(neu)).toBeNull()
  })
  test('andere Sparten fragen nicht nach der Skala', () => {
    expect(scaleRequired({ ...emptyMeterForm(), type: 'waerme' })).toBe(false)
    expect(meterBody({ ...emptyMeterForm(), name: 'Wasser' }, null)).toMatchObject({ body: { hcaScale: null } })
  })
  test('ein ohne Skala gespeichertes Gerät bleibt bearbeitbar: andere Felder speichern, der Hinweis sagt, was fehlt', () => {
    const alt = meterToForm({ id: 'h1', propertyId: 'objekt-1', name: 'Bad', unitId: 'eg', type: 'hkv', unit: 'Einheiten' })
    expect(scaleRequired(alt)).toBe(false)
    expect(meterBody({ ...alt, name: 'Bad oben' }, null)).toMatchObject({ body: { name: 'Bad oben', hcaScale: null, ratingFactor: null } })
    expect(meterScaleHint(alt)).toBe('Für dieses Gerät ist keine Skala gespeichert. Ohne Skala verteilt die eigene Heizkostenabrechnung die Heizkosten nicht; bitte wählen Sie sie, sobald Sie sie kennen.')
    expect(meterScaleHint({ ...alt, hca: { scale: 'product', factor: '' } })).toBeNull()
  })
  test('eine gespeicherte Skala lässt sich nicht leeren, und der Wechsel der Sparte zum Heizkostenverteiler verlangt sie', () => {
    const mit = meterToForm({ id: 'h1', propertyId: 'objekt-1', name: 'Bad', unitId: 'eg', type: 'hkv', unit: 'Einheiten', hcaScale: 'product' })
    expect(scaleRequired(mit)).toBe(true)
    expect(meterBody({ ...mit, hca: { scale: '', factor: '' } }, null)).toMatchObject({ field: 'hcaScale' })
    const wasser = meterToForm({ id: 'm1', propertyId: 'objekt-1', name: 'Zähler', unitId: 'eg', type: 'sonstig', unit: 'Einheiten' })
    const gewechselt = withMeterType(wasser, 'hkv')
    expect(scaleRequired(gewechselt)).toBe(true)
    expect(meterBody(gewechselt, null)).toMatchObject({ field: 'hcaScale' })
  })
})

// Durchsicht von #723, S6: Altbestand mit Faktor, aber ohne Skala. Vorher fiel der Faktor beim Speichern eines anderen
// Felds still weg (`hcaFieldsBody` schickte ohne Einheitsskala `null`), und zählten die Ablesungen in einer
// abgeschlossenen Heizperiode, lehnte der Server mit 409 ab.
describe('#723 Durchsicht S6: gespeicherter Faktor ohne Skala', () => {
  const alt = meterToForm({ id: 'h1', propertyId: 'objekt-1', name: 'Bad', unitId: 'eg', type: 'hkv', unit: 'Einheiten', ratingFactor: 0.825 })
  test('der Faktor bleibt erhalten, solange niemand ihn ändert', () => {
    expect(hcaFieldsBody('hkv', alt.hca)).toEqual({ body: { hcaScale: null, ratingFactor: 0.825 } })
    expect(meterBody({ ...alt, name: 'Bad oben', hca: { ...alt.hca, scale: 'unit' } }, null)).toMatchObject({ body: { name: 'Bad oben', hcaScale: 'unit', ratingFactor: 0.825 } })
    // Die Produktskala enthält den Faktor; ihn zu leeren ist dann die Wahl des Vermieters.
    expect(meterBody({ ...alt, hca: { ...alt.hca, scale: 'product' } }, null)).toMatchObject({ body: { hcaScale: 'product', ratingFactor: null } })
  })
  test('beim Bearbeiten verlangt das Formular die Skala und sagt, warum', () => {
    expect(scaleRequired(alt)).toBe(true)
    const ohne = meterBody({ ...alt, name: 'Bad oben' }, null)
    expect(ohne).toMatchObject({ error: SCALE_MISSING_WITH_FACTOR, field: 'hcaScale', short: 'Skala fehlt' })
    expect(SCALE_MISSING_WITH_FACTOR).toBe('Für dieses Gerät ist ein Bewertungsfaktor gespeichert, aber keine Skala. Bitte wählen Sie die Skala: Erst sie sagt, ob die Abrechnung den Ablesewert mit dem Faktor malnimmt (Einheitsskala) oder ob er im Wert schon enthalten ist (Produktskala). Ohne Skala verteilt die eigene Heizkostenabrechnung die Heizkosten nicht.')
    expect(meterScaleHint(alt)).toBe(SCALE_MISSING_WITH_FACTOR)
    expect(meterScaleHint({ ...alt, hca: { ...alt.hca, scale: 'unit' } })).toBeNull()
  })
})
