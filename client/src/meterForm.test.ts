// Die Einheit eines Zählers folgt seiner Sparte (#142): Ein Wärmezähler, bei dem niemand die
// Einheit geändert hat, zeigte „m³“.
import { describe, expect, test } from 'vitest'
import { asksCalibration, asksRemote, calibrationSuggestion, defaultMeterUnit, emptyMeterForm, heatingRoleLabel, heatingRoleOptions, meterBody, meterPlantId, meterToForm, meterUnitHint, meterUnitOptions, oldEndText, readingDigits, readingText, withMeterType } from './meterForm'

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
    body: { name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh', heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01', hcaScale: null, ratingFactor: null, calibratedUntil: null },
  })
  // Ohne Anlage im Objekt bleibt es ein Hauptzähler, und dann fragt das Formular nicht nach § 5. Die
  // Felder fehlen dann im Rumpf, damit eine gespeicherte Angabe bleibt (Durchsicht von #230, M1).
  const ohneAnlage = meterBody(speicher, null)
  expect(ohneAnlage).toMatchObject({ body: { heatingPlantId: null, heatingRole: null } })
  expect('body' in ohneAnlage && Object.hasOwn(ohneAnlage.body, 'remoteReadable')).toBe(false)
  expect('body' in ohneAnlage && Object.hasOwn(ohneAnlage.body, 'installedOn')).toBe(false)
  const hkvOhneAnlage = meterBody({ ...emptyMeterForm(), name: 'HKV', unitId: 'eg', type: 'hkv', unit: 'Einheiten', remote: 'no' }, null)
  expect('body' in hkvOhneAnlage && Object.hasOwn(hkvOhneAnlage.body, 'remoteReadable')).toBe(false)
  expect(asksRemote({ ...emptyMeterForm(), unitId: 'eg', type: 'hkv' }, false)).toBe(false)
  expect(asksRemote({ ...emptyMeterForm(), unitId: 'eg', type: 'hkv' }, true)).toBe(true)
  // Der Gaszähler gehört dem Versorger: Rolle ja, Fernablesbarkeit nein.
  expect(meterBody({ ...speicher, name: 'Gas', type: 'sonstig', heatingRole: 'supply' }, 'hp1'))
    .toMatchObject({ body: { heatingPlantId: 'hp1', heatingRole: 'supply', remoteReadable: null, installedOn: null } })
  // An einer Wohnung: Kaltwasser ohne, Heizkostenverteiler mit Fernablesbarkeit.
  expect(meterBody({ ...emptyMeterForm(), name: 'Küche', unitId: 'eg', remote: 'yes' }, 'hp1')).toMatchObject({ body: { unitId: 'eg', heatingPlantId: null, remoteReadable: null } })
  const hkv = { ...emptyMeterForm(), name: 'HKV Bad', unitId: 'eg', type: 'hkv' as const, unit: 'Einheiten', remote: 'yes' as const }
  expect(meterBody(hkv, 'hp1')).toMatchObject({ body: { remoteReadable: true, heatingPlantId: null } })
  expect(meterBody({ ...hkv, unitId: '' }, 'hp1')).toMatchObject({ error: expect.stringMatching(/Heizkörper/) })
  expect(meterBody({ ...hkv, name: ' ' }, 'hp1')).toMatchObject({ error: 'Bitte einen Namen für den Zähler angeben.' })
})

test('Bearbeiten: was gespeichert ist, steht wieder im Formular', () => {
  expect(meterToForm({
    id: 'm1', propertyId: 'objekt-1', name: 'Speicher', unitId: null, type: 'waerme', unit: 'kWh',
    heatingPlantId: 'hp1', heatingRole: 'dhwHeat', remoteReadable: false, installedOn: '2022-03-01',
  })).toEqual({ id: 'm1', name: 'Speicher', unitId: '', type: 'waerme', meterNumber: '', unit: 'kWh', keptUnit: 'kWh', unitDropped: '', keptType: 'waerme', heatingRole: 'dhwHeat', keptRole: 'dhwHeat', remote: 'no', installedOn: '2022-03-01', heatingPlantId: 'hp1', hca: { scale: '', factor: '' }, calibratedUntil: '' })
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
    const hkv = meterBody({ ...emptyMeterForm(), name: 'HKV', type: 'hkv', unitId: 'u1', calibratedUntil: '2028' }, null)
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
