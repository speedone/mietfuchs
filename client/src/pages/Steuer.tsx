import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Settings, TaxReport } from '../types'
import { api, fmtEuro } from '../api'
import { useYear, YEAR_OPTIONS } from '../year'
import PageHeader from '../components/PageHeader'
import { DEFAULT_BASIS, incomeCentsFor, prepaymentNote, surplusCentsFor, taxHints, type Basis } from '../taxView'

type Props = { settings: Settings | null }

export default function Steuer({ settings }: Props) {
  const { year, setYear } = useYear()
  const [data, setData] = useState<TaxReport | null>(null)
  // Steuerlich maßgeblich ist das tatsächlich Zugeflossene; das vereinbarte Soll bleibt zum
  // Abgleich umschaltbar. Die Begründung steht in taxView.ts.
  const [basis, setBasis] = useState<Basis>(DEFAULT_BASIS)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return api<TaxReport>(`/api/taxreport/${year}`)
      .then((d) => { setData(d); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year])

  useEffect(() => { void load() }, [load])

  function print() {
    const prevTitle = document.title
    document.title = `Steuerübersicht Anlage V ${year}`.replace(/[\\/:*?"<>|]/g, '-')
    const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 60)
  }

  const incomeCents = data ? incomeCentsFor(data, basis) : 0
  const surplusCents = data ? surplusCentsFor(data, basis) : 0
  const sharePct = data ? Math.round(data.selfUsedAreaShare * 1000) / 10 : 0
  const hints = data ? taxHints(data, basis) : []
  const note = data ? prepaymentNote(data) : null

  return (
    <>
      <div className="no-print">
        <PageHeader title="Steuer · Anlage V" subtitle={'Jahresübersicht für die Einkünfte aus Vermietung — Einnahmen, Werbungskosten und Überschuss. Als PDF speichern über „Drucken".'} />
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field">
            Jahr
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">
            Einnahmen ansetzen als
            <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="ist">tatsächlich gezahlt (Zuflussprinzip)</option>
              <option value="soll">vereinbart (Soll) — nur zum Abgleich</option>
            </select>
          </label>
          <div className="field grow" />
          <button className="btn secondary" onClick={print} disabled={!data}>🖨 Drucken / PDF</button>
        </div>
      </div>

      {data && (
        <>
          <div className="kpis no-print">
            <div className="kpi">
              <div className="v">{fmtEuro(incomeCents)}</div>
              <div className="l">Einnahmen {year}</div>
            </div>
            <div className="kpi">
              <div className="v">{fmtEuro(data.expenses.totalCents)}</div>
              <div className="l">Werbungskosten</div>
            </div>
            <div className="kpi">
              <div className="v" style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEuro(surplusCents)}
              </div>
              <div className="l">{surplusCents >= 0 ? 'Überschuss' : 'Verlust'} (Einkünfte)</div>
            </div>
          </div>

          <div className="card">
            <div className="muted" style={{ marginBottom: 8 }}>
              {settings?.landlordName && <>{settings.landlordName} · </>}
              {settings?.houseName}{settings?.address ? ` · ${settings.address}` : ''}
            </div>
            <h2 style={{ marginBottom: 2 }}>Steuerübersicht {year} — Einkünfte aus Vermietung und Verpachtung</h2>
            <div className="muted" style={{ marginBottom: 14 }}>
              Einnahmen angesetzt als {basis === 'soll' ? 'vereinbartes Soll' : 'tatsächlich gezahlt (Zuflussprinzip)'}.
              Werbungskosten mit dem Jahr, unter dem die Kostenposition erfasst ist — für die Anlage V
              zählt dort das Jahr der Zahlung (§ 11 Abs. 2 EStG).
            </div>

            {/* Auch im Druck sichtbar: Ein ausgedrucktes Blatt auf Soll-Basis ginge sonst ohne
                jeden Vorbehalt zum Steuerberater oder ins Formular. */}
            {hints.includes('sollIsNotTaxBasis') && (
              <div className="notice" style={{ marginBottom: 14 }}>
                <strong>Diese Ansicht rechnet mit dem vereinbarten Soll.</strong> Für die Anlage V
                zählt, was tatsächlich zugeflossen ist (§ 11 Abs. 1 Satz 1 EStG) — eine vereinbarte,
                aber nicht gezahlte Miete ist keine Einnahme. Das Soll ist zum Abgleich gedacht, etwa
                um Rückstände zu sehen. Für die Steuererklärung bitte auf
                <em> tatsächlich gezahlt</em> umschalten.
              </div>
            )}

            <h3>Einnahmen</h3>
            <table>
              <tbody>
                <tr>
                  <td>Mieteinnahmen ohne Umlagen (Kaltmiete, vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.baseRentSollCents)}</td>
                </tr>
                <tr>
                  <td>Umlagen / Nebenkosten-Vorauszahlungen (vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.prepaymentSollCents)}</td>
                </tr>
                <tr className="subtotal">
                  <td><strong>Summe Soll (brutto)</strong></td>
                  <td className="num"><strong>{fmtEuro(data.income.sollCents)}</strong></td>
                </tr>
                <tr>
                  {/* **Kein „davon" mehr.** Seit das Zugeflossene nach Datum summiert wird und
                      nicht mehr über die Zeilen des Mietkontos, ist es kein Teil des Solls: Eine
                      Zahlung kann zu einem Mietverhältnis gehören, das im Jahr gar keine Zeile
                      hat. Gemessen steht dann Soll 0,00 € und eingegangen 800,00 €. Aus demselben
                      Grund fehlt hier „(Rückstand offen)": Es verglich zwei verschiedene
                      Grundmengen. Wer wissen will, wer im Rückstand ist, fragt das Mietkonto. */}
                  <td>Tatsächlich eingegangen {year} (Zufluss)</td>
                  <td className="num">{fmtEuro(data.income.paidCents)}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Angesetzte Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
              </tfoot>
            </table>

            {hints.includes('paymentsMissing') && (
              <div className="notice" style={{ marginTop: 10 }}>
                <strong>
                  {data.income.tenanciesWithoutPayment === data.income.tenanciesWithSoll
                    ? `Für ${year} ist keine einzige Zahlung erfasst.`
                    : `Für ${data.income.tenanciesWithoutPayment} von ${data.income.tenanciesWithSoll} Mietverhältnissen ist ${year} keine einzige Zahlung erfasst.`}
                </strong>{' '}
                Die angesetzten Einnahmen sind dann zu niedrig, und das sieht man der Summe nicht an.
                Bitte im <em>Mietkonto</em> nachtragen, bevor diese Zahl in die Anlage V geht.
              </div>
            )}

            {/* Der Befund aus #70: Abrechnung und Steuerübersicht nennen bei den Vorauszahlungen
                verschiedene Zahlen, und beide sind richtig. Bisher stand das nirgends, und wer sie
                verglich, hielt eine davon für falsch.
                **Keine Ursache behaupten.** Der Abstand kann aus der Jahreskorrektur kommen oder
                daraus, dass ein Mietverhältnis auf einer Wohnung außerhalb der Abrechnungseinheit
                liegt, und meistens aus beidem zu unbekannten Teilen. Der erste Entwurf schrieb ihn
                der Korrektur zu; gemessen kamen von 1.500 € Abstand nur 600 € von dort. */}
            {note && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Die Abrechnung {year} setzt bei den Vorauszahlungen{' '}
                <strong>{fmtEuro(note.settlementCents)}</strong> an, hier steht das vereinbarte Soll
                von {fmtEuro(note.sollCents)}. Beide Zahlen sind richtig und beantworten verschiedene
                Fragen: Die Abrechnung stellt die tatsächlich geleisteten Vorauszahlungen ein und
                verteilt nur über Wohnungen, die zur Abrechnungseinheit gehören.
                {note.jahreskorrektur && <> Für {year} ist dazu eine <strong>Jahreskorrektur der
                Vorauszahlungen</strong> erfasst.</>}
              </p>
            )}

            <h3 style={{ marginTop: 18 }}>Werbungskosten</h3>
            {data.expenses.groups.length === 0 ? (
              <div className="empty">Keine Kostenpositionen für {year} erfasst.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="num">Betrag</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.groups.map((g) => (
                    <Fragment key={g.group}>
                      {g.categories.map((c) => (
                        <tr key={c.category}>
                          <td>
                            <span className="muted">{g.group} · </span>{c.category}
                          </td>
                          <td className="num">{fmtEuro(c.amountCents)}</td>
                        </tr>
                      ))}
                      {g.categories.length > 1 && (
                        <tr className="subtotal">
                          <td>Summe {g.group}</td>
                          <td className="num">{fmtEuro(g.amountCents)}</td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Summe Werbungskosten</td>
                    <td className="num">{fmtEuro(data.expenses.totalCents)}</td>
                  </tr>
                </tfoot>
              </table>
            )}

            <h3 style={{ marginTop: 18 }}>Ergebnis</h3>
            <table>
              <tbody>
                <tr>
                  <td>Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
                <tr>
                  <td>abzüglich Werbungskosten</td>
                  <td className="num">− {fmtEuro(data.expenses.totalCents)}</td>
                </tr>
                <tr className="subtotal">
                  <td><strong>{surplusCents >= 0 ? 'Überschuss (Einkünfte)' : 'Verlust (negative Einkünfte)'}</strong></td>
                  <td className="num">
                    <strong style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtEuro(surplusCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>

            {data.expenses.labor35aCents > 0 && (
              <p className="muted" style={{ marginTop: 14 }}>
                In den Werbungskosten enthaltene Arbeitskosten (§35a EStG, haushaltsnahe
                Dienstleistungen/Handwerker): <strong>{fmtEuro(data.expenses.labor35aCents)}</strong>.
                Diese werden den Mietern in der Nebenkostenabrechnung bescheinigt.
              </p>
            )}

            {/* **Zwei verschiedene Lagen, zwei verschiedene Sätze** (#68). Vorher gab es nur
                einen, und er fragte `!participates`; damit schlug eine ausdrücklich ausgenommene
                Wohnung als Eigennutzung durch, und der Vermieter sollte einen privaten Anteil
                herausrechnen, den es nicht gibt. */}
            {data.selfOccupiedExists && (
              <div className="notice" style={{ marginTop: 14 }}>
                <strong>Gemischt genutztes Gebäude.</strong> <strong>{sharePct.toLocaleString('de-DE')} %</strong>{' '}
                der Fläche sind selbstgenutzt und damit privat. Werbungskosten, die das gesamte Gebäude
                betreffen, sind nur anteilig (nach Fläche) abziehbar; der auf die selbstgenutzte Wohnung
                entfallende Teil ist es nicht.
                {data.selfUsedShareCents > 0 && (
                  <>
                    {' '}Nach der Verteilung dieses Jahres entfallen <strong>{fmtEuro(data.selfUsedShareCents)}</strong>{' '}
                    auf selbstgenutzte Wohnungen — dieser Teil ist in den oben ausgewiesenen Werbungskosten
                    noch enthalten.
                  </>
                )}{' '}
                Bitte den abziehbaren Anteil mit dem Steuerberater abstimmen — diese Übersicht nimmt die
                Aufteilung nicht automatisch vor.
              </div>
            )}

            {/* Der dritte Zustand, den es vorher nicht gab. Hier stehen zwei ganz verschiedene
                Bestände nebeneinander, und Mietfuchs kann sie nicht unterscheiden: die getrennt
                abgerechnete Gewerbeeinheit und die eigene Wohnung aus einem alten Bestand. Der
                Satz fragt deshalb, statt zu behaupten. */}
            {data.excludedExists && (
              <div className="notice" style={{ marginTop: 14 }}>
                <strong>Wohnungen außerhalb der Abrechnungseinheit.</strong> Sie sind weder als vermietet
                noch als selbstgenutzt gekennzeichnet, und deshalb weiß Mietfuchs nicht, wie sie steuerlich
                zu behandeln sind. Nutzen Sie eine davon selbst, stellen Sie sie in den <em>Stammdaten</em> auf
                <em> Eigennutzung</em>; dann beziffert diese Übersicht den privaten Anteil. Sind sie getrennt
                vermietet, etwa eine Gewerbeeinheit mit eigener Abrechnung, betrifft Sie das hier nicht.
              </div>
            )}

            {/* Der Unterschied, den das Issue in die Oberfläche verlangt hat. */}
            {(data.selfOccupiedExists || data.excludedExists) && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Der Flächenanteil hier rechnet über das <strong>ganze Gebäude</strong>. Die Abrechnung
                desselben Jahres verteilt dagegen nur über die Wohnungen, die zur Abrechnungseinheit
                gehören. Die beiden Anteile können deshalb auseinandergehen, und beide sind richtig: Die
                Abrechnung beantwortet, wer sich eine Rechnung teilt, diese Übersicht, wie viel Ihres
                Gebäudes privat genutzt wird.
              </p>
            )}

            <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
              Diese Übersicht ist eine Aufbereitung der erfassten Daten und <strong>keine Steuerberatung</strong>.
              Maßgeblich sind die amtlichen Formulare und Hinweise der Anlage V des jeweiligen Jahres.
            </p>
          </div>
        </>
      )}
    </>
  )
}
