// Die Liste „Was fehlt noch“ der Seite Heizkosten bei eigener Abrechnung (#690 Punkt 6): welcher Hinweis der
// Abrechnung zu welcher Zeile gehört. Die Liste ist keine zweite Regel neben der Berechnung: Eine Zeile ist nur
// „erledigt“, wenn die Abrechnung der Heizperiode zu ihrem Thema keinen Fehler und keine Warnung trägt. Deshalb steht
// hier jeder Code der Heizung (`heating.`, `co2.`, `fuel.`) und der Zähler (`meter.`) aus dem Katalog der Berechnung
// (`noticeKinds` in server/src/calc.ts): einer Zeile zugeordnet, als „weiterer Hinweis“ (`other`: zählt, hat aber keine
// Zeile) oder mit Grund ausgenommen (`skip`). server/test/heating-todo-codes.test.ts verlangt das für jeden Code, damit
// ein neuer Hinweis später nicht still durchfällt. In `shared/`, weil die Oberfläche die Tabelle liest und der Wächter
// sie gegen den Katalog des Servers hält.
export type TodoStepId = 'costs' | 'share' | 'hotWater' | 'readings' | 'distribution' | 'co2' | 'info'

// `hints`: Auch die Stufe „Hinweis“ färbt die Zeile gelb (der Hinweis nennt eine mögliche Kürzung mit Betrag).
export type TodoCodeRule = { step: TodoStepId | 'other'; hints?: true } | { skip: string }

const step = (s: TodoStepId | 'other'): TodoCodeRule => ({ step: s })
// Zähler kalter Positionen: Diese Hinweise tragen den Zähler oder die Kostenposition als Bezug, nie die Heizanlage;
// in der eigenen Heizkostenabrechnung meldet die Berechnung dasselbe als `heating.self-incomplete` an der Anlage.
const COLD = { skip: 'Verbrauchsschlüssel kalter Positionen und Zähler-Seite; an der Heizanlage steht dafür heating.self-incomplete' }
const ZAEHLER_PAGE = { skip: 'steht nur auf der Seite „Zähler & Stände“ und im Cockpit, nie an der Abrechnung' }
const SELF_SUPPLY = { skip: 'Mieter mit eigenem Brennstoffvertrag: betrifft das Mietverhältnis, nicht die Heizanlage' }
const FREE_KEYS = { skip: 'nur bei freien Schlüsseln, nie bei eigener Heizkostenabrechnung' }

export const HEATING_TODO_CODES: Readonly<Record<string, TodoCodeRule>> = {
  // ---------- Kosten der Heizung ----------
  'heating.target-invalid': step('costs'),
  'co2.item-spans-plants': step('costs'),
  'fuel.share-by-degree-days': step('costs'),
  'fuel.fixed-unknown': step('costs'),
  'fuel.uncovered': step('costs'),
  'fuel.manual-beyond-period': FREE_KEYS,
  'fuel.closed-period-part': step('costs'),
  'fuel.zero-invoice': step('costs'),
  'fuel.credit-only': step('costs'),
  'fuel.credit-only-confirmed': step('costs'),
  'fuel.estimate-undistributed': step('costs'),
  'fuel.estimated': step('costs'),
  'fuel.estimate-settled': step('costs'),
  'fuel.estimate-overcharged': step('costs'),
  'fuel.loose-item': step('costs'),
  'fuel.delivery-unlinked': step('costs'),
  // Stufe „Hinweis“ an der Position des Schornsteinfegers: färbt nicht, steht aber beim Thema Kosten.
  'heating.chimney-sweep-central': step('costs'),
  'fuel.cancelled-after-close': step('costs'),
  'fuel.reduced-after-close': step('costs'),
  'fuel.owner-closed-unlinked': step('costs'),
  'fuel.stock-invalid': step('costs'),
  'fuel.stock-missing-self': step('costs'),
  'fuel.before-2023': step('costs'),
  'fuel.stock-date-differs': step('costs'),
  'fuel.manual-by-delivery': FREE_KEYS,
  'fuel.stock-remaining': step('costs'),
  'fuel.stock-not-taken-over': step('costs'),
  'fuel.opening-settled': step('costs'),
  'fuel.opening-settled-assumed': step('costs'),
  'fuel.opening-check-loose': step('costs'),
  'fuel.opening-not-settled': step('costs'),
  'fuel.stock-unlinked': step('costs'),
  'heating.operating-power-key': step('costs'),
  'heating.operating-power-exceeds': step('costs'),
  'heating.operating-power-double': step('costs'),
  'heating.operating-power-missing': step('costs'),
  'heating.operating-power-deduction-missing': step('costs'),
  'heating.operating-power-bill-missing': step('costs'),
  'heating.operating-power-not-reported': step('costs'),
  'heating.generation-power-missing': step('costs'),
  // ---------- Anteil nach Verbrauch ----------
  'heating.share-forced-unsure': step('share'),
  'heating.share-invalid': step('share'),
  'heating.key-change': step('share'),
  // ---------- Warmwasseranteil ----------
  'heating.dhw-share-invalid': step('hotWater'),
  'heating.heat-pump-dhw-basis': step('hotWater'),
  'heating.dhw-share-estimated': step('hotWater'),
  'heating.dhw-not-metered': step('hotWater'),
  'heating.heating-value-from-table': step('hotWater'),
  'heating.dhw-share-implausible': step('hotWater'),
  // ---------- Ablesungen, Geräte, Schätzung ----------
  'heating.interim-reading-off': step('readings'),
  'heating.interim-reading-far': step('readings'),
  'heating.no-interim-reading': step('readings'),
  'heating.no-interim-reading-missed': step('readings'),
  'heating.reading-dates-differ': step('readings'),
  'heating.reading-dates-far': step('readings'),
  'heating.no-consumption': step('readings'),
  'heating.reading-estimate-over-25': step('readings'),
  // #690 Punkt 2: Einer Wohnung fehlt das Gerät; behoben wird es auf „Zähler & Stände“ (Gerät anlegen, ggf. schätzen).
  'heating.unit-without-device': step('readings'),
  'heating.device-cutoff': step('readings'),
  'heating.mixed-capture': step('readings'),
  'heating.hca-factor-missing': step('readings'),
  'heating.estimate-base-unit': step('readings'),
  'heating.estimate-unconfirmed': step('readings'),
  'heating.estimated': step('readings'),
  'heating.estimate-over-25': step('readings'),
  'heating.estimate-complete': step('readings'),
  'heating.estimate-stale': step('readings'),
  'heating.estimate-stale-unused': step('readings'),
  'heating.estimate-no-device': step('readings'),
  'heating.estimate-below-measured': step('readings'),
  'heating.estimate-same-day': step('readings'),
  // ---------- Verteilung ----------
  'heating.self-incomplete': step('distribution'),
  'heating.heat-pump-majority-open': step('distribution'),
  'heating.unit-unserved': step('distribution'),
  // ---------- CO₂-Kosten ----------
  'co2.sum-check': step('co2'),
  'co2.sum-check-approx': step('co2'),
  'co2.pool-foreign-item': step('co2'),
  'co2.share-capped': step('co2'),
  'co2.reliefs-invalid': step('co2'),
  'co2.reliefs-missing': step('co2'),
  'co2.probably-deducted': step('co2'),
  'co2.missing': step('co2'),
  'co2.missing-first-year': step('co2'),
  'co2.fuel-unknown': step('co2'),
  'co2.exempt-deducted': step('co2'),
  'co2.cost-implausible': step('co2'),
  'co2.service-unsplit': step('co2'),
  'co2.incomplete': step('co2'),
  'co2.stage-mismatch': step('co2'),
  'co2.district-ets-exempt': step('co2'),
  'co2.service-unsplit-healed': step('co2'),
  'co2.service-fuel-mismatch': step('co2'),
  'co2.share-approximated': step('co2'),
  'co2.exceeds-heating': step('co2'),
  'co2.pool-keys': step('co2'),
  'co2.restriction': step('co2'),
  'co2.non-residential': step('co2'),
  'co2.short-period-agreed': step('co2'),
  'co2.plant-replaced': step('co2'),
  'co2.building-joint': step('co2'),
  'co2.classification-incomplete': step('co2'),
  'co2.half-split': step('co2'),
  'co2.half-split-two-family': step('co2'),
  'co2.half-split-missing': step('co2'),
  // #704: Antwort „liegt bei“ der CO₂-Karte, nur bei Abrechnung durch den Messdienst; Stufe „Hinweis“, färbt nicht.
  'co2.service-enclosed': step('co2'),
  'fuel.stock-missing': step('co2'),
  // ---------- Angaben zur Abrechnung (§ 6a) ----------
  'heating.info-incomplete': step('info'),
  'heating.info-open': { step: 'info', hints: true },
  'heating.monthly-info': step('info'),
  // ---------- Weitere Hinweise zur Heizung ohne eigene Zeile ----------
  'heating.remote-reading': step('other'),
  'heating.remote-reading-missing': step('other'),
  'heating.flat-rate': step('other'),
  'heating.exemption': step('other'),
  'heating.change-split-time': step('other'),
  'heating.change-split-degree-days': step('other'),
  'heating.change-fee': step('other'),
  'heating.heat-pump-capture': step('other'),
  'heating.heat-pump-old-exemption': step('other'),
  'heating.pipe-heat': step('other'),
  'heating.pre-capture': step('other'),
  'heating.contracting': step('other'),
  'heating.per-unit-basis': step('other'),
  // ---------- Ausgenommen ----------
  'heating.not-by-consumption': FREE_KEYS,
  'heating.all-by-consumption': FREE_KEYS,
  'heating.consumption-share': FREE_KEYS,
  'heating.may-agree-otherwise': FREE_KEYS,
  'heating.self-supply-operating-power': SELF_SUPPLY,
  'heating.fuel-for-self-supply': SELF_SUPPLY,
  'co2.self-supply-items': SELF_SUPPLY,
  'co2.self-supply-mixed': SELF_SUPPLY,
  'co2.refund-late': SELF_SUPPLY,
  'co2.refund-not-next': SELF_SUPPLY,
  'co2.refund-due': SELF_SUPPLY,
  'co2.refund-differs': SELF_SUPPLY,
  'co2.refund-not-self': SELF_SUPPLY,
  'meter.replacement-without-end': ZAEHLER_PAGE,
  'meter.negative': ZAEHLER_PAGE,
  'meter.same-day': ZAEHLER_PAGE,
  'meter.calibration-overdue': ZAEHLER_PAGE,
  'meter.reading-estimated': ZAEHLER_PAGE,
  'meter.negative-in-key': COLD,
  'meter.reading-future': COLD,
  'meter.units-mixed': COLD,
  'meter.unit-unknown': COLD,
  'meter.no-consumption': COLD,
  'meter.unit-without-meter': COLD,
  'meter.unit-not-read': COLD,
  'meter.sub-exceeds-main': COLD,
  'meter.main-partial': COLD,
  'meter.main-gap': COLD,
  'meter.unit-partial': COLD,
  'meter.rest-mixed': COLD,
  'meter.rest-unavailable': COLD,
  'meter.sub-incomplete': COLD,
  'meter.rest-high': COLD,
  'meter.rest-not-self': COLD,
  'meter.change-fee': COLD,
}

// Ein Code, den die Tabelle nicht kennt (ein Tab mit älterem Stand der Oberfläche), zählt als weiterer Hinweis: lieber
// eine Zeile zu viel offen als „erledigt“ neben einer Warnung.
export function todoRuleOf(code: string): TodoCodeRule {
  return HEATING_TODO_CODES[code] ?? { step: 'other' }
}
