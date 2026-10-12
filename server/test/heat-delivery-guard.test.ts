// Wächter für die Naht der Wärmelieferung (Heizung PR 16, #213): Wo Schreibwege und Oberfläche nach der
// Energie einer Anlage entscheiden, fragen sie `billingEnergy(plant)` (shared/heatDelivery.ts) und nicht
// `plant.energy`. Sonst rechnet die Abrechnung Contracting wie Fernwärme, aber die Einrichtung verlangt 70 %
// nach Verbrauch, einen Vorrat, eine Heizwerttabelle oder fragt nach dem Betriebsstrom (Prüfung C-M3, C-M4,
// C-M6). Die Berechnung bekommt die Anlage schon mit der Energie der Abrechnung (`asBilledPlant` in
// snapshot.ts) und ist deshalb ausgenommen.
//
// Erlaubte Stellen stehen unten benannt, jede mit Grund. Eine erlaubte Stelle, die es nicht mehr gibt, ist ein
// Fehler: Sonst bliebe die Ausnahme stehen und deckte später etwas anderes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const E = String.raw`[\w.?]+\.energy\b`
const ENERGY_DECISION = new RegExp([
  String.raw`\b(?:STOCK_ENERGIES|METERED_ENERGIES|OIL_OR_GAS|CO2_FUELS|CO2_ENERGIES|POWER_GENERATED|OPERATING_POWER_BURNERS|NO_CO2_FUELS)\.includes\(\s*${E}`,
  String.raw`\b(?:isStockEnergy|forcedShare|selfSetupBody|insulationAsked|unsureShareHint|operatingPowerRefusal|isBoiler|gradeOptions|defaultGrade|invoiceName)\(\s*${E}`,
  String.raw`\bGRADES_BY_ENERGY\[\s*${E}`,
  String.raw`${E}\s*[!=]==\s*'(?:gas|oil|lpg|coal|pellets|wood|districtHeating|heatPump|electric|other)'`,
  String.raw`\b(?:consumptionSharesOf|distributionOf)\([^()]*?,\s*${E}\s*,`,
  String.raw`\bselfSetupBody\([^()]*?,\s*${E}`,
  String.raw`\bbuildCostItemBody\([^()]*?${E}`,
  String.raw`\b(?:plantEnergy|energy)=\{\s*${E}\s*\}`,
].join('|'), 'g')

// Die Berechnung bekommt die Anlage aus dem Schnappschuss mit der Energie der Abrechnung.
const ENGINE = new Set([
  'server/src/calc.ts', 'server/src/co2.ts', 'server/src/fuel.ts', 'server/src/fuelStock.ts', 'server/src/dhw.ts', 'server/src/heating.ts',
  'server/src/snapshot.ts', 'server/src/heatingInfo.ts', 'server/src/operatingPower.ts', 'server/src/co2Plausibility.ts', 'server/src/hca.ts',
  'server/src/remoteReading.ts', 'shared/heatDelivery.ts',
])

type Allowed = { file: string; match: string; reason: string }
const ALLOWED: readonly Allowed[] = [
  { file: 'client/src/components/HeatingCard.tsx', match: "form.energy === 'heatPump'", reason: 'Fragen zur Wärmepumpe (§ 11 Abs. 1 Nr. 3 a. F., § 12 Abs. 3 HeizkostenV) hängen am Erzeuger, auch bei Contracting.' },
  { file: 'client/src/heatingForm.ts', match: "form.energy === 'heatPump'", reason: 'Frage zum Erzeuger für den Warmwasseranteil; hängt am Erzeuger.' },
  { file: 'client/src/heatingForm.ts', match: "form.energy === 'districtHeating' || (form.contracting", reason: 'Die Angaben zur Umstellung fragt das Formular bei Fernwärme oder Contracting (`asksSwitch`); das ist die Frage nach der Wärmelieferung selbst.' },
  { file: 'client/src/components/HeatingInfoCard.tsx', match: "plant.energy === 'districtHeating'", reason: 'Werte des Wärmenetzes nur bei Fernwärme (§ 6a Abs. 3 Satz 1 Nr. 1 Buchst. a HeizkostenV), nicht bei Contracting (Prüfung C-M2).' },
  { file: 'client/src/components/Co2FactsCard.tsx', match: "plant.energy === 'districtHeating'", reason: 'Emissionshandel (§ 2 Abs. 4 Satz 2 CO2KostAufG) nur bei Fernwärme; eine Ausnahme der Naht.' },
  { file: 'client/src/stockView.ts', match: 'CO2_ENERGIES.includes(h.energy', reason: 'Die Heizperiode der Abrechnung trägt schon die Energie der Abrechnung; einen Vorrat gibt es bei Contracting nicht.' },
  { file: 'server/src/db/heating.ts', match: "after.energy === 'districtHeating'", reason: 'Fernwärme als Etagenheizung und Emissionshandel hängen an der gespeicherten Energie.' },
  { file: 'server/src/db/heating.ts', match: "after.energy !== 'districtHeating'", reason: 'Emissionshandel (§ 2 Abs. 4 Satz 2 CO2KostAufG) nur bei Fernwärme; eine Ausnahme der Naht.' },
  { file: 'server/src/db/heating.ts', match: "merged.energy === 'districtHeating'", reason: 'Emissionshandel nur bei Fernwärme.' },
  { file: 'client/src/fuelForm.ts', match: 'NO_CO2_FUELS.includes(plant.energy)', reason: 'Der Brennstoff des Lieferanten entscheidet über die CO₂-Pflicht (§ 2 Abs. 1 Satz 2 CO2KostAufG); eine Ausnahme der Naht.' },
  // Heizung PR 18 (#215, Abweichung 11 des Plans): Netzentgelte nach § 5a Abs. 1 Nr. 1 CO2KostAufG gibt es bei der
  // „Belieferung mit Gas“; bei Contracting zählt der Brennstoff des Lieferanten, nicht die Energie der Abrechnung.
  { file: 'server/src/db/fuel.ts', match: "plant.energy !== 'gas'", reason: 'Netzentgelte nach § 5a Abs. 1 Nr. 1 CO2KostAufG hängen an der Belieferung mit Gas, bei Contracting an der des Lieferanten; eine Ausnahme der Naht.' },
  { file: 'client/src/components/FuelCard.tsx', match: "plant.energy === 'gas'", reason: 'Das Feld Netzentgelte (§ 5a Abs. 1 Nr. 1 CO2KostAufG) hängt an der Belieferung mit Gas, bei Contracting an der des Lieferanten; eine Ausnahme der Naht.' },
]

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { recursive: true }).map(String)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts') && !f.includes('testing'))
    .map((f) => path.join(dir, f).split(path.sep).join('/'))
}

// Je Treffer Zeile und Text. Gelesen wird der Quelltext ohne Kommentare, aber mit Zeichenketten, denn das
// Muster eines Vergleichs braucht den Wert (`plant.energy === 'gas'`); der Scanner der übrigen Wächter ersetzt
// Zeichenketten und fasst JSX-Text zusammen, sodass die Zeilen nicht mehr stimmten.
const withoutComments = (line: string): string => line.replace(/\/\*.*?\*\//g, '').replace(/(^|\s)\/\/.*$/, '$1')
export function energyDecisions(file: string, source: string): { file: string; line: number; match: string; text: string }[] {
  let block = false
  return source.split('\n').flatMap((raw, i) => {
    let line = raw
    if (block) {
      const end = line.indexOf('*/')
      if (end < 0) return []
      block = false
      line = line.slice(end + 2)
    }
    const open = line.indexOf('/*')
    if (open >= 0 && line.indexOf('*/', open) < 0) {
      block = true
      line = line.slice(0, open)
    }
    const code = withoutComments(line)
    return [...code.matchAll(ENERGY_DECISION)].map((m) => ({ file, line: i + 1, match: m[0], text: code }))
  })
}

test('Wärmelieferung: Schreibwege und Oberfläche entscheiden nach billingEnergy, nicht nach plant.energy', () => {
  const found = [...files('server/src'), ...files('client/src'), ...files('shared')]
    .filter((f) => !ENGINE.has(f))
    .flatMap((f) => energyDecisions(f, fs.readFileSync(path.join(ROOT, f), 'utf8')))
  const allowed = (h: { file: string; text: string }) => ALLOWED.some((a) => a.file === h.file && h.text.includes(a.match))
  const open = found.filter((h) => !allowed(h)).map((h) => `${h.file}:${h.line}: ${h.match}`)
  assert.deepEqual(open, [], `Bitte billingEnergy(plant) aus shared/heatDelivery.ts nehmen:\n${open.join('\n')}`)
  const stale = ALLOWED.filter((a) => !found.some((h) => h.file === a.file && h.text.includes(a.match)))
  assert.deepEqual(stale, [], 'Eine erlaubte Stelle gibt es nicht mehr; bitte aus ALLOWED streichen.')
})

test('Wächter der Wärmelieferung: erkennt die Muster und lässt billingEnergy durch (Mutationsprobe)', () => {
  const sample = [
    'if (STOCK_ENERGIES.includes(plant.energy)) x()',
    'const f = forcedShare(plant.energy, form.insulation)',
    'distributionOf(rows, ctx.plant.energy, h, today)',
    "if (plant.energy === 'other') throw y",
    'const ok = isBoiler(plant.energy)',
    'const g = GRADES_BY_ENERGY[plant.energy]',
    "const t = plant.energy === 'heatPump' || plant.energy === 'districtHeating'",
    'buildCostItemBody(form, units, period, tenancies, plantOfForm?.energy)',
    'const r = selfSetupBody(form, plant.energy)',
    'if (STOCK_ENERGIES.includes(billingEnergy(plant))) x()',
    'const g2 = forcedShare(billingEnergy(plant), form.insulation)',
    "const name = ENERGY_NAMES[plant.energy]",
  ].join('\n')
  assert.deepEqual(energyDecisions('probe.ts', sample).map((s) => s.line), [1, 2, 3, 4, 5, 6, 7, 7, 8, 9])
  assert.deepEqual(energyDecisions('probe.tsx', '<Card plantEnergy={plantOfForm?.energy} energy={plant.energy} />').length, 2)
})
