import { Fragment, useCallback, useEffect, useId, useRef, useState } from 'react'
import { startPrint, type PrintJob } from '../printJob'
import type { Settings, TaxExpenseItem, TaxReport } from '../types'
import { api, fmtArea, fmtDate, fmtEuro } from '../api'
import { localToday } from '../periodForm'
import { usePeriod } from '../period'
import { CalendarYearSelect } from '../components/PeriodSelect'
import { useProperty, withProperty } from '../property'
import { effectiveLandlord, letterhead } from '../landlord'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import { costModelLineTexts, acquisitionRelated, acquisitionRelatedText, ACQUISITION_RELATED_MORE, ACQUISITION_RELATED_TITLE, headerRows, allocationLabel, assignedUnitItems, DEFAULT_BASIS, excludedAreaDifference, incomeCentsFor, keyNotAreaDifference, operatingPowerBalanceText, prepaymentNote, settlementSourcesText, showsSplit, stockCarryNote, surplusCentsFor, taxHints, maintenanceLineText, withdrawalLinesText, usageChangeTouchesWithdrawal, withdrawalSuspectDated, ETW_WITHDRAWAL_TEXT, type Basis, movedInLines, movedInText, movedOutLabels, movedOutLines, unstatedText, type ShiftLine } from '../taxView'
import { StepList } from '../components/CalcSteps'
import DisclosureButton from '../components/DisclosureButton'
import Term from '../components/Term'
import { NoticeBox, TextNotice } from '../components/Notice'
import CheapRentCard from '../components/CheapRentCard'
import { percentText, verdictText } from '../cheapRent'
import { andList } from '../../../shared/wording.ts'
import { OPERATING_POWER_KEPT, OPERATING_POWER_REPORTED } from '../../../shared/operatingPower.ts'
import { anlageVLines } from '../anlageV'
import type { NoticeTab } from '../notices'
import { formerYearsText, incomeMore, incomeTable, lateDecemberText, OLD_LEASE_MORE, oldLeaseForwardText, possibleDepositText, TURN_OF_YEAR_MORE, turnOfYearLines, unallocatedText, unitRows } from '../taxIncome'

// `onNavigate`: der Sprung in die Stammdaten bei einer nicht eingetragenen Kopfangabe (#96 PR 2).
type Props = { settings: Settings | null; onNavigate?: (tab: NoticeTab) => void }

export default function Steuer({ settings, onNavigate }: Props) {
  // Die Steuer rechnet im Kalenderjahr (#208, Entwurf 3.10).
  const { calendarYear: year } = usePeriod()
  const { property } = useProperty()
  const propertyId = property?.id
  // Vermieter, IBAN und Frist: am Objekt abweichend, sonst aus den Einstellungen (#92).
  const landlord = settings ? effectiveLandlord(property, settings) : null
  const [data, setData] = useState<TaxReport | null>(null)
  // Steuerlich maßgeblich ist das tatsächlich Zugeflossene; das vereinbarte Soll bleibt zum
  // Abgleich umschaltbar. Die Begründung steht in taxView.ts.
  const [basis, setBasis] = useState<Basis>(DEFAULT_BASIS)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return api<TaxReport>(withProperty(`/api/taxreport/${year}`, propertyId))
      .then((d) => { setData(d); setError('') })
      .catch((e) => setError(String((e as Error).message)))
  }, [year, propertyId])

  useEffect(() => { void load() }, [load])

  // Der Seitentitel wird zum Dateinamen beim „Als PDF speichern“; zurückgesetzt wird er erst bei der
  // nächsten Bedienung (Safari, siehe printJob.ts).
  const printJob = useRef<PrintJob | null>(null)
  useEffect(() => () => printJob.current?.cancel(), [])
  function print() {
    printJob.current?.cancel()
    printJob.current = startPrint({ title: `Steuerübersicht Anlage V ${year}`, delayMs: 60 })
  }

  const incomeCents = data ? incomeCentsFor(data, basis) : 0
  const surplusCents = data ? surplusCentsFor(data, basis) : 0
  // `null`, solange keine Fläche erfasst ist: Ein Prozentsatz von 0 wäre dort eine Aussage
  // über etwas, das niemand eingetragen hat.
  const sharePct = data && data.totalAreaM2 > 0
    ? Math.round((data.selfUsedAreaM2 / data.totalAreaM2) * 1000) / 10
    : null
  const hints = data ? taxHints(data, basis, property?.kind, property) : []
  const acquisition = data ? acquisitionRelated(data, property ?? null) : null
  const note = data ? prepaymentNote(data) : null
  const sources = data ? settlementSourcesText(data) : null
  // Teilweise Eigennutzung (#163): Spalten privat und abziehbar nur, wenn es etwas Privates gibt.
  const split = data ? showsSplit(data) : false
  const keyDiff = data ? keyNotAreaDifference(data) : null
  const excludedDiff = data ? excludedAreaDifference(data) : null
  const assigned = data ? assignedUnitItems(data) : []

  return (
    <>
      <div className="no-print">
        <PageHeader context="calendar" title="Steuer (Anlage V)" subtitle={'Jahresübersicht für die Einkünfte aus Vermietung — Einnahmen, Werbungskosten und Überschuss. Als PDF speichern über „Drucken“.'} />
      </div>
      {error && <NoticeBox level="error" action={error} />}

      <div className="card no-print">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <CalendarYearSelect className="width-s" />
          <label className="field">
            Einnahmen ansetzen als
            <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)}>
              <option value="ist">tatsächlich gezahlt (Zuflussprinzip)</option>
              <option value="soll">vereinbart (Soll) — nur zum Abgleich</option>
            </select>
          </label>
          <div className="field" />
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
            {/* #163: Die Hauptzahl ist der abziehbare Teil, der private steht klein darunter. Ohne
                Eigennutzung sind beide dieselbe Zahl, und die Karte bleibt, wie sie war. */}
            <div className="kpi">
              <div className="v">{fmtEuro(data.expenses.deductibleCents)}</div>
              <div className="l">{split ? 'Werbungskosten (abziehbar)' : 'Werbungskosten'}</div>
              {split && (data.expenses.privateCents !== 0 || data.expenses.gratuitousCents) && (
                <div className="muted" style={{ fontSize: 12 }}>
                  gesamt {fmtEuro(data.expenses.totalCents)}
                  {data.expenses.privateCents !== 0 && <> · davon privat {fmtEuro(data.expenses.privateCents)}</>}
                  {data.expenses.gratuitousCents ? <> · unentgeltlich {fmtEuro(data.expenses.gratuitousCents)}</> : null}
                </div>
              )}
            </div>
            <div className="kpi">
              <div className="v" style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmtEuro(surplusCents)}
              </div>
              <div className="l">{surplusCents >= 0 ? 'Überschuss' : 'Verlust'} (Einkünfte)</div>
            </div>
          </div>

          <div className="card">
            {/* Kopfzeile mit dem Tag des Ausdrucks (N5, #341), wie auf der Abrechnung */}
            <div className="muted flex flex-wrap justify-between gap-x-4">
              <span>{letterhead(landlord?.landlordName, property)}</span>
              <span>Stand {fmtDate(localToday())}</span>
            </div>
            <h2>Steuerübersicht {year} — Einkünfte aus Vermietung und Verpachtung</h2>
            <div className="muted">
              Einnahmen angesetzt als {basis === 'soll' ? 'vereinbartes Soll' : 'tatsächlich gezahlt (Zuflussprinzip)'}.
              Werbungskosten im Jahr der Zahlung (§ 11 Abs. 2 EStG), wenn an der Kostenposition „Bezahlt am“
              eingetragen ist; ohne Datum im Jahr ihrer Abrechnung.
            </div>

            {/* Auch im Druck sichtbar: Ein ausgedrucktes Blatt auf Soll-Basis ginge sonst ohne
                jeden Vorbehalt zum Steuerberater oder ins Formular. */}
            {/* M8 (#346, Schritt 10): jeder Hinweis als Titel, ein Satz „was tun“ und der Rest unter „Mehr dazu“;
                im Druck steht der Rest mit da (NoticeBox). */}
            {hints.includes('sollIsNotTaxBasis') && (
              <NoticeBox
                level="warning"
                title="Diese Ansicht rechnet mit dem vereinbarten Soll."
                action={<>Für die Steuererklärung bitte auf <em>tatsächlich gezahlt</em> umschalten.</>}
                more={<>
                  Für die Anlage V zählt, was tatsächlich zugeflossen ist (§ 11 Abs. 1 Satz 1 EStG) — eine vereinbarte,
                  aber nicht gezahlte Miete ist keine Einnahme. Das Soll ist zum Abgleich gedacht, etwa um Rückstände zu sehen.
                </>}
              />
            )}

            <h3>Kopf der Anlage V</h3>
            {/* #96 PR 2 (Entwurf B3): der Kopf der Anlage V, auch im Druck, vor den Einnahmen wie im Vordruck. Der Kommentar
                steht hinter der Überschrift: davor läse der Wächter S31 (uiRules.test.ts) die Karte als eine mit Überschrift. */}
            <Table>
              <tbody>
                {headerRows(data, property, year).map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.label}
                      {r.line !== null && <div className="muted cell-sub">Zeile {r.line}{r.code !== undefined ? `, Kennzahl ${r.code}` : ''}</div>}
                    </td>
                    <td className="num">
                      {r.value ?? <>
                        <span className="muted">nicht eingetragen</span>
                        {onNavigate && <> <button className="btn small ghost no-print" onClick={() => onNavigate('stammdaten')}>Hier eintragen → Stammdaten</button></>}
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="muted">
              {anlageVLines(year)?.header?.use !== undefined ? `Zeile ${anlageVLines(year)?.header?.use}: ` : ''}Eine Ferienwohnung oder kurzfristige
              Vermietung rechnet Mietfuchs nicht; dafür gibt es die Anlage V-FeWo. Die <Term id="cheapRent">verbilligte Vermietung</Term> an
              Angehörige prüft die Übersicht bei den Werbungskosten.
            </div>

            <h3>Einnahmen</h3>
            {/* #312 PR 3: eine Tabelle nach Zeilen der Anlage V mit zwei Betragsspalten, eingegangen (Ist) und vereinbart
                (Soll). Die Spalte der gewählten Grundlage steht vorn, die andere heißt „zum Abgleich“. Zeilen, Beträge
                und Bedingungen kommen aus taxIncome.ts; die Seite rendert nur. Am Handy `stacked`. */}
            <IncomeTableView report={data} basis={basis} />
            <p className="muted fine">
              Tragen Sie jede Zeile einzeln ein; die Summe ergibt sich {anlageVLines(year)?.income.total !== undefined ? `in Zeile ${anlageVLines(year)?.income.total}` : 'daraus'}.
              Eingegangen und vereinbart lassen sich nur in der Summe vergleichen: Ein Rückstand oder eine Vorauszahlung
              verschiebt Beträge zwischen den Zeilen und Jahren, und Nachzahlungen aus der Abrechnung und Mieten für frühere
              Jahre haben kein vereinbartes Gegenstück.
            </p>
            <IncomeMore year={year} />
            <UnitIncome report={data} year={year} />

            {/* #312 PR 3 (E8 nach der Durchsicht von PR 2): die Zehn-Tage-Regel nur mit Betrag. Mietfuchs wendet sie an, wo
                die Fälligkeit aus dem Gesetz folgt (§ 556b Abs. 1 BGB); vorwärts ruhig, ohne Vorbehalt. Nie ein Satz, der
                eine Verschiebung ins alte Jahr nahelegt, wenn die Fälligkeit außerhalb der kurzen Zeit lag. */}
            {hints.includes('turnOfYear') && (
              <NoticeBox
                level="hint"
                title={<><Term id="tenDayRule">Zehn-Tage-Regel</Term> am Jahreswechsel</>}
                action={<>{turnOfYearLines(data).map((l) => <span key={l} className="block">{l}</span>)}</>}
                more={TURN_OF_YEAR_MORE}
              />
            )}
            {hints.includes('turnOfYearOldLease') && (
              <NoticeBox
                level="hint"
                title="Januarmiete Ende Dezember: Fälligkeit laut Vertrag prüfen"
                action={oldLeaseForwardText(data)}
                more={OLD_LEASE_MORE}
              />
            )}
            {hints.includes('lateDecember') && <p className="muted fine">{lateDecemberText(data)}</p>}
            {hints.includes('unallocatedPayment') && (
              <NoticeBox
                level="hint"
                title={unallocatedText(data)}
                action={<>
                  Prüfen Sie im <em>Mietkonto</em>, wofür die Zahlung war, etwa eine Kaution, eine Zahlung nach dem Auszug oder
                  nach dem Ende einer Staffel. Mietfuchs zählt den Betrag zu den Mieten ohne Umlagen.
                </>}
              />
            )}
            {hints.includes('possibleDeposit') && (
              <NoticeBox
                level="warning"
                title="Ist das die Kaution?"
                context={possibleDepositText(data)}
                action={<>
                  Prüfen Sie im <em>Mietkonto</em> Art und Betrag. Ist es die Kaution, löschen Sie die Zahlung dort; die Kaution
                  steht am Mietverhältnis.
                </>}
                more="Der Vermieter hat die Kaution getrennt von seinem Vermögen anzulegen (§ 551 Abs. 3 BGB)."
              />
            )}
            {hints.includes('formerYears') && (
              <NoticeBox
                level="hint"
                title={<><Term id="formerYearsRent">Mieten für frühere Jahre</Term></>}
                action={formerYearsText(data)}
              />
            )}

            {hints.includes('paymentsMissing') && (
              <NoticeBox
                level="warning"
                title={data.income.tenanciesWithoutPayment === data.income.tenanciesWithSoll
                  ? `Für ${year} ist keine einzige Mietzahlung erfasst.`
                  : `Für ${data.income.tenanciesWithoutPayment} von ${data.income.tenanciesWithSoll} Mietverhältnissen ist ${year} keine einzige Mietzahlung erfasst.`}
                action={<>
                  Die angesetzten Einnahmen sind dann zu niedrig, und das sieht man der Summe nicht an. Bitte
                  im <em>Mietkonto</em> nachtragen, bevor diese Zahl in die Anlage V geht.
                </>}
              />
            )}

            {/* #336 und #323: nur benannt, nicht gerechnet. Ein Satz für jeden, ohne Bedingung: Ob ein
                Mieter Kosten übernommen hat oder eine Garage umsatzsteuerpflichtig ist, kann Mietfuchs am
                Bestand nicht sicher erkennen (eine Einheit ohne Fläche kann auch eine Wohnung mit vergessener
                Fläche sein, und die Nebenleistung hängt am Mieter, nicht an der Einheit). */}
            <p className="muted fine">
              Zwei Dinge rechnet Mietfuchs nicht: Kosten, die ein Mieter für Sie übernommen hat, etwa eine mit der
              Miete verrechnete Renovierung (<Term id="tenantPaidCosts">vom Mieter übernommene Kosten</Term>), und die
              Umsatzsteuer, die bei einer getrennt vermieteten Garage oder einem Stellplatz anfallen kann
              (<Term id="garageVat">Umsatzsteuer bei Garage und Stellplatz</Term>).
            </p>

            {/* Der Befund aus #70: Abrechnung und Steuerübersicht nennen bei den Vorauszahlungen
                verschiedene Zahlen, und beide sind richtig. Bisher stand das nirgends, und wer sie
                verglich, hielt eine davon für falsch.
                **Keine Ursache behaupten.** Der Abstand kann aus der Jahreskorrektur kommen oder
                daraus, dass ein Mietverhältnis auf einer Wohnung außerhalb der Abrechnungseinheit
                liegt, und meistens aus beidem zu unbekannten Teilen. Der erste Entwurf schrieb ihn
                der Korrektur zu; gemessen kamen von 1.500 € Abstand nur 600 € von dort. */}
            {sources && <p className="muted">{sources}</p>}
            {note && (
              <NoticeBox
                level="hint"
                title="Vorauszahlungen in Abrechnung und Steuerübersicht"
                action={<>
                  Die Abrechnung {year} setzt bei den Vorauszahlungen{' '}
                  <strong>{fmtEuro(note.settlementCents)}</strong> an, hier steht das vereinbarte Soll
                  von {fmtEuro(note.sollCents)}.
                </>}
                more={<>
                  Beide Zahlen sind richtig und beantworten verschiedene
                  Fragen: Die Abrechnung setzt die vereinbarten Vorauszahlungen an, oder den tatsächlich
                  gezahlten Betrag, wenn Sie ihn dort mit „✎ anpassen“ erfasst haben, und verteilt nur über
                  Wohnungen, die zur Abrechnungseinheit gehören.
                  {note.jahreskorrektur && <> Für {year} ist dazu eine <strong>Jahreskorrektur der
                  Vorauszahlungen</strong> erfasst.</>}
                  {note.closed && <> Die Abrechnung {year} ist abgeschlossen: Ihr Ansatz steht so da, wie
                  er beim Abschluss gerechnet wurde, das Soll rechnet Mietfuchs heute. Rechnet Mietfuchs
                  inzwischen anders, zum Beispiel im angebrochenen Ein- oder Auszugsmonat, zeigt die Seite
                  Abrechnung den Unterschied.</>}
                </>}
              />
            )}

            <h3>Werbungskosten</h3>
            {data.expenses.groups.length === 0 ? (
              <div className="empty">Keine Kostenpositionen für {year} erfasst.</div>
            ) : split ? (
              <SplitTable report={data} />
            ) : (
              <Table>
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
                            {c.category}
                            <div className="muted cell-sub">{g.group}</div>
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
              </Table>
            )}

            {/* #96 PR 1 (A4.1): die Zeilen des Erhaltungsaufwands, auch im Druck. Vor der Kürzung nach den Zeilen 87/88, in
                der Reihenfolge des Vordrucks (Test in Steuer.test.tsx). */}
            {hints.includes('maintenanceLines') && (() => {
              const t = maintenanceLineText(data)
              return (
                <NoticeBox
                  level="hint"
                  title="Erhaltungsaufwand, einschließlich Entnahmen aus der Erhaltungsrücklage"
                  action={<>{t.unspread}{t.unspread && t.spread ? ' ' : ''}{t.spread}</>}
                  more="Eine Entnahme zählt im Jahr, in dem die Gemeinschaft das Geld für die Maßnahme ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24); das steht in ihrer Hausgeldabrechnung dieses Jahres."
                />
              )
            })()}
            {/* #96 PR 2 (A4.4, Durchsicht X6): anschaffungsnahe Herstellungskosten, auch im Druck. */}
            {hints.includes('acquisitionRelated') && acquisition && (
              <NoticeBox
                level="hint"
                title={<><Term id="acquisitionRelatedCosts">Anschaffungsnahe Herstellungskosten</Term>: {ACQUISITION_RELATED_TITLE}</>}
                action={acquisitionRelatedText(acquisition)}
                more={ACQUISITION_RELATED_MORE}
              />
            )}
            {/* #257: Auch im Druck, denn der Steuerberater braucht Quote und Vergleichsmiete; je Wohnung alle Urteile, auch
                Prognose, Untergrenze und fehlende Vergleichsmiete (Durchsicht von PR #422, S2). */}
            {(() => {
              const law = data.cheapRent?.law
              if (!law) return null
              return (data.cheapRent?.units ?? []).filter((u) => u.tenancies.length > 0).map((u) => (
                <NoticeBox key={u.unitId} level="hint"
                  title={<>Verbilligte Vermietung: {u.unitName}</>}
                  action={<>
                    {u.tenancies.map((t) => <span key={t.tenancyId} className="block">{verdictText(t, law)}</span>)}
                    {u.gratuitousCents !== 0 && (
                      <span className="block">
                        {fmtEuro(u.gratuitousCents)} der Werbungskosten dieser Wohnung sind als unentgeltlicher Teil nicht abziehbar
                        (entgeltlich {percentText(u.paidFactor)}); die Spalte „abziehbar“ zeigt sie schon gekürzt, bitte nicht ein zweites Mal
                        kürzen. Abschreibung und Schuldzinsen der Wohnung kürzen Sie nach derselben Quote.
                      </span>
                    )}
                  </>}
                  more={<>Ortsübliche Warmmiete laut {u.sources.map((e) => `${e.source}, Stand ${fmtDate(e.sourceDate)}`).join('; ')}. {law.cite}.</>}
                />
              ))
            })()}
            {/* #143: Die Zuführung zur Erhaltungsrücklage steht neben den Werbungskosten. Auch im
                Druck, damit der Betrag beim Steuerberater nicht als vergessen gilt. */}
            {hints.includes('reserveContribution') && (
              <NoticeBox
                level="hint"
                title={<>{data.reserveContributionCents < 0
                  // Saldiert negativ, etwa durch eine Rückzahlung oder Korrektur: dann ist es keine Zuführung.
                  ? 'Erhaltungsrücklage, saldiert (Rückzahlung oder Korrektur)'
                  : 'Zuführung zur Erhaltungsrücklage'}: {fmtEuro(data.reserveContributionCents)}</>}
                action="Nicht in den Werbungskosten enthalten: Sie ist erst abziehbar, wenn und soweit die Gemeinschaft das Geld für Erhaltungsmaßnahmen ausgibt."
                more={<>
                  Erst dann steht fest, ob es Erhaltungsaufwand oder Herstellungskosten sind
                  (BFH, Urteil vom 14.01.2025, IX R 19/24). Die Ausgaben aus der Rücklage nennt die Hausgeldabrechnung des
                  Jahres, in dem die Gemeinschaft sie bezahlt; Ihren Anteil daran erfassen Sie dann als „Entnahme
                  Erhaltungsrücklage“.
                </>}
              />
            )}
            {hints.includes('reserveSuspected') && (
              <NoticeBox
                level="warning"
                title="Vielleicht eine Zuführung zur Erhaltungsrücklage"
                context={data.reserveSuspects.map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`).join(', ')}
                action={<>Ist es die Zuführung, stellen Sie unter <em>Kosten</em> die Kostenart „Zuführung Erhaltungsrücklage“ ein.</>}
                more={<>
                  {data.reserveSuspects.length === 1 ? 'Sie steht' : 'Sie stehen'} oben in den Werbungskosten. Abziehbar ist eine
                  Zuführung erst, wenn die Gemeinschaft das Geld ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24).
                </>}
              />
            )}
            {/* #96 PR 1 (A4.2): umgekehrt eine Entnahme unter „Nicht umlagefähig“. Die Zahl bleibt, nur die Zeile hängt daran. */}
            {hints.includes('reserveWithdrawalSuspected') && (
              <NoticeBox
                level="hint"
                title="Vielleicht eine Entnahme aus der Erhaltungsrücklage"
                context={(data.reserveWithdrawalSuspects ?? []).map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`).join(', ')}
                action={<>Stellen Sie unter <em>Kosten</em> die Kostenart „Entnahme Erhaltungsrücklage“ ein; an den Beträgen ändert sich nichts, nur die Zeile der Anlage V.</>}
                more={<>
                  {withdrawalLinesText(year)}
                  {withdrawalSuspectDated(data) && <> Für das Jahr zählt, wann die Gemeinschaft das Geld ausgibt, laut ihrer Hausgeldabrechnung,
                  nicht das Ihrer eigenen Hausgeldzahlung; beim Umstellen entfällt das Zahlungsdatum, und sein Jahr bleibt als Jahr der Zahlung stehen.</>}
                </>}
              />
            )}
            {/* #96 PR 1 (A4.3, R5): Sonderumlage. Auslegung nach derselben Begründung wie bei der Rücklage; nichts wird umgestellt. */}
            {hints.includes('specialLevy') && (
              <NoticeBox
                level="hint"
                title="Sonderumlage: Ihre eigene Zahlung an die Gemeinschaft zählt nicht"
                context={(data.specialLevySuspects ?? []).map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`).join(', ')}
                action={<>
                  Fließt die Sonderumlage in die Rücklage, ist sie eine Zuführung („Zuführung Erhaltungsrücklage“). Hat die Gemeinschaft damit
                  eine Maßnahme bezahlt, gilt Ihr Anteil laut Jahresabrechnung im Jahr der Ausgabe; erfassen Sie ihn als „Entnahme
                  Erhaltungsrücklage“ ohne Datum. Mietfuchs stellt nichts um.
                </>}
                more="Mietfuchs wendet dieselbe Begründung an wie bei der Erhaltungsrücklage (BFH, Urteil vom 14.01.2025, IX R 19/24): Abziehbar ist, was die Gemeinschaft für die Maßnahme ausgibt, nicht die Zahlung an die Gemeinschaft."
              />
            )}
            {/* #268: Betriebsstrom der Heizung. Die Stromrechnung zählt genau einmal zu den Werbungskosten. */}
            {hints.includes('operatingPowerBalance') && (
              <TextNotice level="hint" title="Betriebsstrom der Heizung" text={operatingPowerBalanceText(data) ?? ''} />
            )}
            {hints.includes('operatingPowerAmbiguous') && (
              <NoticeBox
                level="warning"
                title="Betriebsstrom: dem Messdienst gemeldet?"
                context={andList((data.operatingPowerAmbiguous ?? []).map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`))}
                action={<>
                  Geben Sie es unter <em>Kosten</em> am Abzug an. Ist der Betrag dem Messdienst nicht gemeldet, wählen Sie
                  „{OPERATING_POWER_KEPT}“: Dann tragen Sie diesen Betriebsstrom selbst, und die Übersicht zählt ihn zu Ihren
                  Werbungskosten (§ 9 Abs. 1 Satz 1 EStG). Ist er gemeldet, wählen Sie „{OPERATING_POWER_REPORTED}“; dann entfällt
                  dieser Hinweis.
                </>}
                more={<>
                  {(data.operatingPowerAmbiguous ?? []).length === 1 ? 'Er zählt' : 'Sie zählen'} als dem Messdienst gemeldet, denn im
                  Zeitraum heizt eine Anlage mit Messdienst. Zugleich heizt dort eine Anlage ohne Messdienst, etwa nach einem
                  Kesseltausch. Ob der Betrag dem Messdienst gemeldet ist, kann Mietfuchs ohne Ihre Angabe nicht erkennen.
                </>}
              />
            )}
            {hints.includes('unmarkedPowerCredits') && (
              <NoticeBox
                level="warning"
                title="Negativer Betrag beim Allgemeinstrom ohne Kennzeichnung"
                context={andList((data.unmarkedPowerCredits ?? []).map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`))}
                action={<>
                  Ist es ein Abzug für den Betriebsstrom der Heizung, kennzeichnen Sie ihn unter <em>Kosten</em> bei der Frage
                  nach dem Abzug des Betriebsstroms; sonst fehlt er in Ihren Werbungskosten.
                </>}
                more="Die Übersicht zählt ihn wie erfasst."
              />
            )}

            {/* #255, PR 4: was zwischen den Jahren verschoben ist. Nur Auskunft, die Summe oben ist die der Positionen,
                die in diesem Jahr bezahlt sind. Auch im Druck, denn genau diese Positionen fragt der Steuerberater nach. */}
            {hints.includes('movedIn') && (
              <NoticeBox
                level="hint"
                title={`In ${year} bezahlt, aus einer anderen Abrechnung.`}
                action={<>
                  Diese Positionen stehen in den Werbungskosten {year}, denn Ausgaben sind für das Kalenderjahr abzusetzen, in
                  dem sie geleistet worden sind (§ 11 Abs. 2 Satz 1 EStG).{' '}
                  {/* Der Begriff ist ein Knopf am Bildschirm, im Druck fehlte ihm die Erklärung (N5). */}
                  <span className="no-print"><Term id="paymentDate">Was heißt das?</Term></span>
                </>}
                more={data.selfOccupiedExists
                  // Durchsicht von PR 4, K2: „Nicht umlagefähig“ wird nach Zuordnung oder Fläche geteilt, nicht nach der Abrechnung.
                  ? 'Den privaten Teil rechnet Mietfuchs wie im Zeitraum, zu dem sie gehören: umlagefähige Kosten nach dessen Abrechnung, die übrigen nach Zuordnung oder Fläche.'
                  : null}
              >
                <ShiftList lines={movedInLines(data)} />
              </NoticeBox>
            )}
            {hints.includes('movedOut') && (
              <NoticeBox
                level="hint"
                title={`In der Abrechnung ${andList(movedOutLabels(data))}, aber in einem anderen Jahr bezahlt.`}
                action={`Diese Positionen zählen nicht zu den Werbungskosten ${year}, sondern zu denen des Jahres, in dem sie bezahlt sind.`}
                more="Die Abrechnung an die Mieter enthält sie unverändert."
              >
                <ShiftList lines={movedOutLines(data)} />
              </NoticeBox>
            )}
            {hints.includes('unstated') && <p className="muted fine">{unstatedText(data)}</p>}

            <h3>Ergebnis</h3>
            <Table>
              <tbody>
                <tr>
                  <td>Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
                <tr>
                  <td>{split ? 'abzüglich abziehbarer Werbungskosten' : 'abzüglich Werbungskosten'}</td>
                  <td className="num">− {fmtEuro(data.expenses.deductibleCents)}</td>
                </tr>
                <tr className="subtotal">
                  <td><strong>{surplusCents >= 0 ? 'Überschuss (Einkünfte)' : 'Verlust (negative Einkünfte)'}</strong></td>
                  <td className="num">
                    <strong style={{ color: surplusCents >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtEuro(surplusCents)}</strong>
                  </td>
                </tr>
              </tbody>
            </Table>

            {data.expenses.labor35aCents > 0 && (
              <p className="muted">
                In den Werbungskosten enthaltene Arbeitskosten (§ 35a EStG, haushaltsnahe
                Dienstleistungen/Handwerker): <strong>{fmtEuro(data.expenses.labor35aCents)}</strong>.
                Diese werden den Mietern in der Nebenkostenabrechnung bescheinigt.
              </p>
            )}
            {/* Heizung PR 8 (N8): Brennstoff aus dem Vorrat; Abrechnung nach Verbrauch, Steuer nach Bezahltem. */}
            {stockCarryNote(data) && <p className="muted">{stockCarryNote(data)}</p>}

            {/* #96: Kopfzeilen der Anlage V, die am Mietmodell hängen; die Nummern nur aus `anlageVLines` (K4, taxView.ts).
                Die Pauschale nennt die Anleitung nicht ausdrücklich. */}
            {hints.includes('inclusiveLine24') && (
              <NoticeBox
                level="hint"
                title={costModelLineTexts(year).inclusiveTitle}
                action={costModelLineTexts(year).inclusiveAction}
                more="Bei einer Inklusivmiete sind die Nebenkosten nicht gesondert vereinbart."
              />
            )}
            {hints.includes('inclusiveLine24Mixed') && (
              <NoticeBox
                level="hint"
                title={costModelLineTexts(year).inclusiveTitle}
                action="Bei gemischten Verträgen klären Sie den Eintrag am besten mit Ihrem Steuerberater."
                more="Eine Inklusivmiete gilt hier nur für einen Teil der Mietverhältnisse oder nur für einen Teil der Nebenkosten (nur kalt oder nur die Heizung). Die Zeile fragt für das ganze Objekt, ob Nebenkosten gesondert vereinbart sind."
              />
            )}
            {hints.includes('flatRateLine20') && (
              <NoticeBox
                level="hint"
                title={costModelLineTexts(year).flatRateTitle}
                action="Eine Betriebskostenpauschale ist eine Einnahme wie die Miete."
                more={costModelLineTexts(year).flatRateMore}
              />
            )}
            {hints.includes('etwHousingMoney') && (
              <NoticeBox
                level="hint"
                title="Eigentumswohnung: abgeflossen ist das gezahlte Hausgeld."
                action="Gleichen Sie die Zahlen mit Ihren Kontoauszügen ab: Mietfuchs setzt die Kosten mit dem Jahr der Kostenposition an."
                more={<>
                  Werbungskosten sind im Jahr der Zahlung anzusetzen (§ 11 Abs. 2 EStG). Das sind die Hausgeld-Vorschüsse dieses
                  Jahres und eine Nachzahlung aus der Abrechnung des Vorjahres, nicht die Beträge der Hausgeldabrechnung dieses Jahres.
                  {' '}{ETW_WITHDRAWAL_TEXT}
                </>}
              />
            )}
            {/* **Zwei verschiedene Lagen, zwei verschiedene Sätze** (#68). Vorher gab es nur
                einen, und er fragte das zweiwertige „nicht vermietet“ ab; damit schlug eine
                ausdrücklich ausgenommene Wohnung als Eigennutzung durch, und der Vermieter sollte
                einen privaten Anteil herausrechnen, den es nicht gibt.
                **Genannt werden Quadratmeter und nicht nur ein Prozentsatz.** Genau diese beiden
                Zahlen fragt die Anlage V im Kopf ab, und ein bloßer Prozentsatz lädt dazu ein, den
                Rest für den abziehbaren Anteil zu halten. Das stimmt nur, solange es keine
                Wohnungen außerhalb der Abrechnungseinheit gibt; deshalb steht der Vorbehalt
                daneben, sobald es sie gibt. */}
            {data.selfOccupiedExists && (
              <NoticeBox
                level="hint"
                title="Gemischt genutztes Gebäude."
                action={<>
                  Von {fmtArea(data.totalAreaM2)} Gesamtfläche
                  sind <strong>{fmtArea(data.selfUsedAreaM2)}</strong> selbstgenutzt und damit privat
                  {sharePct !== null && <> ({sharePct.toLocaleString('de-DE')} %)</>}. Zusammen
                  sind <strong>{fmtEuro(data.expenses.privateCents)}</strong> privat
                  und <strong>{fmtEuro(data.expenses.deductibleCents)}</strong> abziehbar.{' '}
                  <span className="no-print"><Term id="mixedUse">Was heißt das?</Term></span>
                </>}
                more={<>
                  Werbungskosten sind nur abziehbar, soweit sie auf den vermieteten Teil entfallen
                  (§ 9 Abs. 1, § 12 Nr. 1 EStG). Diese Übersicht teilt deshalb jede Position auf: Was einer
                  Einheit direkt zugeordnet ist, gehört ganz zu ihr; Kosten des ganzen Gebäudes werden nach dem
                  Verhältnis der Wohn- und Nutzflächen aufgeteilt (BFH, Urteil vom 24.06.2008, IX R 26/06); bei
                  umlagefähigen Kosten gilt der Eigenanteil aus der Nebenkostenabrechnung, damit beide dasselbe
                  sagen.
                </>}
              />
            )}
            {hints.includes('mixedUseSplit') && (
              <NoticeBox
                level="hint"
                title="In der Anlage V."
                action="Zeile 11 fragt die Gesamtwohnfläche, Zeile 12 den eigengenutzten oder unentgeltlich überlassenen Wohnraum darin; bitte stimmen Sie die Aufteilung mit Ihrem Steuerberater ab."
                more={<>
                  Dorthin gehört nur Wohnfläche:
                  Garagen, Keller und andere Zubehörräume zählen nicht mit; für die Aufteilung der Gebäudekosten zählt
                  eine eingetragene Fläche dagegen, denn maßgeblich sind Wohn- und Nutzflächen. Die Werbungskosten
                  gehören in die Zeilen „durch direkte Zuordnung ermittelt“ und „durch verhältnismäßige Zuordnung
                  ermittelt“, dort mit Gesamtbetrag und abzugsfähigem Anteil; beides steht oben je Position. Teilen
                  Sie zum ersten Mal verhältnismäßig auf, erläutern Sie Maßstab und Zuordnung in einer gesonderten
                  Aufstellung; dafür taugt der Ausdruck dieser Übersicht samt Rechenweg.
                </>}
              />
            )}
            {hints.includes('mixedUseKeyNotArea') && keyDiff && (
              <NoticeBox
                level="hint"
                title={`Privater Teil nach dem Umlageschlüssel, nach der Fläche ${fmtEuro(keyDiff.differenceCents)} anders`}
                action="Bitte klären Sie den Maßstab mit Ihrem Steuerberater."
                more={<div>
                  Bei {keyDiff.count === 1 ? 'einer Position' : `${keyDiff.count} Positionen`} verteilt die
                  Nebenkostenabrechnung nach Personen, Wohneinheiten oder vereinbarten Anteilen, und der private Teil
                  folgt diesem Schlüssel. Nach Fläche wären es zusammen <strong>{fmtEuro(keyDiff.differenceCents)}</strong> anders.
                  Eine leerstehende Wohnung zählt beim Personenschlüssel mit einer Person je Tag; ihr Anteil bleibt als
                  Leerstand bei Ihnen und ist nicht privat. Kosten einer leerstehenden Wohnung bleiben abziehbar, solange
                  Sie sie vermieten wollen (Vermietungsabsicht).
                  Für Kosten, die sich nicht direkt zuordnen lassen, nennt der Bundesfinanzhof das Verhältnis der Wohn-
                  und Nutzflächen als Regelmaßstab; ob ein Umlageschlüssel als Maßstab anerkannt wird, ist nicht
                  entschieden. Mietfuchs übernimmt den Eigenanteil der Abrechnung, damit Abrechnung und Steuer dasselbe
                  sagen; den Vergleich nach Fläche zeigt der Rechenweg der Position.
                </div>}
              />
            )}
            {hints.includes('mixedUseExcludedArea') && excludedDiff && (
              <NoticeBox
                level="hint"
                title="Einheiten außerhalb der Abrechnungseinheit: Aufteilung nach Gebäudefläche"
                action={<>
                  Für die Steuer teilt diese Übersicht {excludedDiff.count === 1 ? 'eine Position' : `${excludedDiff.count} Positionen`} nach
                  der Fläche über das ganze Gebäude auf; gegenüber der Abrechnung sind das zusammen{' '}
                  {excludedDiff.lessPrivateCents > 0 && <><strong>{fmtEuro(excludedDiff.lessPrivateCents)}</strong> weniger</>}
                  {excludedDiff.lessPrivateCents > 0 && excludedDiff.morePrivateCents > 0 && ' und '}
                  {excludedDiff.morePrivateCents > 0 && <><strong>{fmtEuro(excludedDiff.morePrivateCents)}</strong> mehr</>}
                  {' '}privat.
                </>}
                more={<>
                  Zum Gebäude gehören Einheiten außerhalb der Abrechnungseinheit. Die Nebenkostenabrechnung verteilt
                  nur über die Abrechnungseinheit; ihr Eigenanteil lässt diese Einheiten außen vor und ist deshalb kein
                  Anteil am ganzen Gebäude. Den Eigenanteil laut Abrechnung zeigt der Rechenweg der Position.
                </>}
              />
            )}
            {hints.includes('mixedUseClosedItemsChanged') && (
              <p className="muted fine">
                {data.closedItemsChanged === 1 ? 'Eine Position wurde' : `${data.closedItemsChanged} Positionen wurden`} nach dem Abschluss der Abrechnung {year} erfasst
                oder geändert. Sie {data.closedItemsChanged === 1 ? 'steht' : 'stehen'} nicht so auf dem Papier beim Mieter; ihren privaten Teil rechnet die
                Übersicht deshalb mit den heutigen Daten.
              </p>
            )}
            {hints.includes('mixedUseAreaMissing') && (
              <NoticeBox
                level="warning"
                title="Fläche fehlt für die Aufteilung"
                action="Bitte tragen Sie die Fläche in den Stammdaten ein."
                more={<>
                  Mindestens eine Position ließ sich nicht aufteilen, weil für eine betroffene Einheit keine Fläche
                  hinterlegt ist. Sie steht ungekürzt bei den abziehbaren Werbungskosten.
                </>}
              />
            )}
            {hints.includes('mixedUseDirectOutside') && (
              <NoticeBox
                level="warning"
                title="Position einer Einheit außerhalb der Abrechnungseinheit"
                action="Nutzen Sie diese Einheit selbst, stellen Sie sie in den Stammdaten auf Eigennutzung; sonst sind die abziehbaren Werbungskosten zu hoch."
                more="Mindestens eine Position ist einer Einheit außerhalb der Abrechnungseinheit zugeordnet. Mietfuchs zählt sie als abziehbar."
              />
            )}
            {hints.includes('mixedUseAssignedUnits') && (
              <NoticeBox
                level="warning"
                title="„Nicht umlagefähig“ für die Steuer zugeordnet"
                action={<>
                  Betrifft eine Position das ganze Gebäude, wählen Sie unter <em>Kosten</em> bei
                  „Betrifft (für die Steuer)“ „das ganze Gebäude (nach Fläche)“; dann wird sie nach dem Verhältnis der
                  Flächen aufgeteilt.
                </>}
                more="Positionen aus Mietfuchs 0.8.0 oder älter können eine solche Zuordnung noch aus dem damaligen Umlageschlüssel tragen."
              >
                <div>
                  {assigned.length === 1 ? 'Eine Position' : `${assigned.length} Positionen`} „Nicht umlagefähig“{' '}
                  {assigned.length === 1 ? 'ist' : 'sind'} für die Steuer bestimmten Einheiten zugeordnet:{' '}
                  {assigned.map((x, k) => (
                    <Fragment key={x.costItemId}>
                      {k > 0 && '; '}
                      „{x.description || 'ohne Beschreibung'}“ ({fmtEuro(x.amountCents)}): {andList(x.units)},{' '}
                      {x.effect === 'private' ? 'ganz privat'
                        : x.effect === 'deductible' ? 'ganz abziehbar'
                          : x.effect === 'unsplittable' ? 'nicht aufteilbar (Fläche fehlt), ungekürzt abziehbar'
                            : 'nach der Fläche dieser Einheiten'}
                    </Fragment>
                  ))}.
                </div>
              </NoticeBox>
            )}
            {hints.includes('usageChangedInYear') && (
              <NoticeBox
                level="warning"
                title={`Die Nutzung wechselt in diesem Jahr: ${(data.usageChangedUnits ?? []).join(', ')}.`}
                action={<>
                  Die Übersicht teilt nach den Tagen der Eigennutzung: umlagefähige Kosten nach dem Eigenanteil der Abrechnung, die
                  übrigen nach Fläche und Tagen; auch die selbstgenutzte Fläche oben ist nach Tagen gerechnet. Steht die Wohnung nach
                  Ihrer Eigennutzung leer, bevor Sie sie vermieten, zählt Mietfuchs den Leerstand als abziehbar; das gilt nur, wenn Sie
                  ernsthafte und nachhaltige Vermietungsbemühungen belegen können.
                  {/* #96 (A4.5), Auslegung: ohne Datum der Gemeinschaft die bestmögliche Aufteilung. */}
                  {usageChangeTouchesWithdrawal(data) && <> Bei einer Entnahme aus der Erhaltungsrücklage zählt streng genommen die Nutzung am Tag,
                  an dem die Gemeinschaft bezahlt; ohne dieses Datum teilt Mietfuchs auch sie nach Tagen.</>}
                </>}
                more={<>
                  Aufwendungen für eine zunächst selbst bewohnte, danach leer stehende und noch nicht vermietete Wohnung sind nur
                  abziehbar, wenn der endgültige Entschluss zu vermieten belegt ist (BFH, Urteil vom 28.10.2008, IX R 1/07).
                </>}
              />
            )}
            {hints.includes('mixedUseChangedInYear') && (
              <NoticeBox
                level="warning"
                title="Eine selbstgenutzte Einheit war in diesem Jahr auch vermietet."
                action="Für die Zeit der Vermietung sind ihre Kosten abziehbar; bitte rechnen Sie diesen Teil anteilig nach."
                more={<>
                  Ohne eingetragenen Nutzungswechsel zählt die Aufteilung nach Fläche die Einheit das ganze Jahr als privat.
                  Wohnen Sie dort nur einen Teil des Jahres, tragen Sie den Wechsel in den Stammdaten der Einheit unter
                  „Nutzungswechsel“ ein.
                </>}
              />
            )}
            {hints.includes('mixedUseClosedChanged') && (
              <p className="muted fine">
                Die Abrechnung {year} ist abgeschlossen. Für den privaten Teil der umlagefähigen Kosten gilt der eingefrorene Stand,
                auch wenn die heutige Rechnung etwas anderes ergäbe oder die Abrechnung den Eigenanteil je Position
                noch nicht festhielt; so nennt die Übersicht dieselbe Zahl wie das Papier beim Mieter.
              </p>
            )}
            {hints.includes('mixedUseLabor35a') && (
              <p className="muted fine">
                Bei Positionen mit Lohnanteil (§ 35a EStG) gehört der private Teil nicht zu den Werbungskosten. Ob
                Sie für den Lohnanteil, der auf Ihre eigene Wohnung entfällt, die Steuerermäßigung in Ihrer eigenen Steuererklärung
                nutzen können, klären Sie bitte mit Ihrem Steuerberater; Mietfuchs rechnet sie nicht aus.
              </p>
            )}
            {hints.includes('mixedUseNotCalculated') && (
              <NoticeBox
                level="hint"
                title="Was diese Übersicht nicht rechnet"
                action="Abschreibung, Schuldzinsen und die Verteilung nach § 82b EStDV tragen Sie selbst ein; diese Angaben kennt Mietfuchs nicht. Die Kürzung bei verbilligter Vermietung rechnet Mietfuchs für die erfassten Kosten, wenn Sie unten die ortsübliche Miete eintragen."
                more={<>
                  Nicht gerechnet werden: die Abschreibung (AfA) des Gebäudes, die ebenfalls nur anteilig abziehbar
                  ist (Zeilen 33 und 34); Schuldzinsen, die der Zuordnung des Darlehens folgen und nicht der Fläche; die
                  Verteilung größeren Erhaltungsaufwands auf mehrere Jahre nach § 82b EStDV; und bei verbilligter
                  Vermietung die Kürzung von Abschreibung und Schuldzinsen. Wo der Vordruck die Kürzung bei verbilligter
                  Vermietung abfragt (bisher in den Zeilen 87 und 88 genannt, am Vordruck noch nicht geprüft), sehen Sie bitte im
                  Vordruck des Jahres nach; die Spalte „abziehbar“ dieser Übersicht ist schon gekürzt und darf nicht ein zweites
                  Mal gekürzt werden.
                </>}
              />
            )}

            {/* Der dritte Zustand, den es vorher nicht gab. Hier fallen zwei verschiedene Bestände
                zusammen, und Mietfuchs unterscheidet sie bewusst nicht (die Begründung steht in
                calc.ts): die getrennt abgerechnete Gewerbeeinheit und die eigene Wohnung aus einem
                alten Bestand. Der Satz fragt deshalb, statt zu behaupten. */}
            {data.excludedExists && (
              <NoticeBox
                level="warning"
                title="Wohnungen außerhalb der Abrechnungseinheit."
                action={<>
                  Nutzen Sie eine davon selbst, stellen Sie sie in den <em>Stammdaten</em> auf
                  <em> Eigennutzung</em>; dann teilt diese Übersicht die Werbungskosten auf.
                </>}
                more={<>
                  Diese Wohnungen sind weder
                  als vermietet noch als selbstgenutzt gekennzeichnet, und deshalb weiß Mietfuchs nicht, wie
                  sie steuerlich zu behandeln sind. Sind sie getrennt
                  vermietet, etwa eine Gewerbeeinheit mit eigener Abrechnung, dann stehen ihre Einnahmen hier
                  nur, wenn Sie das Mietverhältnis in Mietfuchs erfasst haben.
                  {data.selfOccupiedExists && (
                    <>
                      {' '}Bei der Aufteilung der Werbungskosten zählen sie mit ihrer Fläche zum vermieteten
                      Teil: Kosten des Gebäudes teilt diese Übersicht nach dem Verhältnis der Flächen des ganzen Gebäudes
                      auf, auch die umlagefähigen, die die Abrechnung nur über die Abrechnungseinheit verteilt. Ist eine
                      dieser Wohnungen in Wahrheit privat, sind die abziehbaren Werbungskosten zu hoch.
                    </>
                  )}
                </>}
              />
            )}

            {/* Der Unterschied, den das Issue in die Oberfläche verlangt hat, und er hängt allein
                an den ausgenommenen Wohnungen. Ohne sie ist die Verteilbasis der Abrechnung
                (vermietet oder selbstgenutzt) genau das ganze Gebäude, die beiden Anteile können
                dann gar nicht auseinandergehen. Das ist der Regelfall des Zielbilds, und ein
                Absatz, der dort einen Unterschied erklärt, den es nicht gibt, ist schlechter als
                keiner. Damit bleibt die Bedingung eine reine Durchreichung vom Server und trägt
                keine eigene Aussage; sie gehört deshalb nicht nach taxView.ts.
                **Und sie verlangt zusätzlich den Kasten darüber.** Der Absatz verweist auf „den
                Flächenanteil hier", und den zeigt nur jener Kasten. Ohne ihn zeigte er ins Leere
                und behauptete von zwei nirgends angezeigten Zahlen, dass sie auseinandergehen —
                ausgerechnet auf der Seite des Vermieters mit altem Bestand, den diese Behebung
                schützen soll. „Können“ statt „gehen“, weil eine ausgenommene Wohnung ohne
                erfasste Fläche beide Grundmengen gleich lässt. */}
            {data.selfOccupiedExists && data.excludedExists && (
              <p className="muted fine">
                Der Flächenanteil hier rechnet über das <strong>ganze Gebäude</strong>. Die Abrechnung
                desselben Jahres verteilt dagegen nur über die Wohnungen, die zur Abrechnungseinheit
                gehören. Die beiden Anteile können deshalb auseinandergehen, und beide sind richtig: Die
                Abrechnung beantwortet, wer sich eine Rechnung teilt, diese Übersicht, wie viel Ihres
                Gebäudes privat genutzt wird.
              </p>
            )}

            <p className="muted fine">
              Diese Übersicht ist eine Aufbereitung der erfassten Daten und <strong>keine Steuerberatung</strong>.
              Maßgeblich sind die amtlichen Formulare und Hinweise der Anlage V des jeweiligen Jahres.
            </p>
          </div>
        </>
      )}
      {/* #257: die ortsübliche Warmmiete je Wohnung und die Quote; gekürzt wird in der Übersicht oben. */}
      <CheapRentCard propertyId={propertyId} year={year} report={data?.cheapRent} onSaved={() => void load()} />
    </>
  )
}

// Die Werbungskosten je Position mit ihrer Aufteilung (#163). Die Spalten folgen dem Vordruck:
// Gesamtbetrag, privater und abzugsfähiger Teil, und ob direkt oder verhältnismäßig zugeordnet.
// Die Zuordnung steht auch im Druck, damit das Blatt als gesonderte Aufstellung taugt; der
// aufklappbare Rechenweg nur am Bildschirm.
function SplitTable({ report }: { report: TaxReport }) {
  const order = report.expenses.groups.map((g) => g.group)
  const items = [...report.expenses.items].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group))
  // #257: die Spalte nur, wenn es einen unentgeltlichen Teil gibt.
  const gratuitous = !!report.expenses.gratuitousCents
  return (
    <Table>
      <thead>
        <tr>
          <th>Position</th>
          <th className="num">Gesamt</th>
          <th className="num">privat</th>
          {gratuitous && <th className="num">unentgeltlich</th>}
          <th className="num">abziehbar</th>
          <th>Zuordnung</th>
          <th className="no-print" />
        </tr>
      </thead>
      <tbody>
        {items.map((x) => <SplitRow key={x.costItemId} item={x} gratuitous={gratuitous} />)}
      </tbody>
      <tfoot>
        <tr>
          <td>Summe Werbungskosten</td>
          <td className="num">{fmtEuro(report.expenses.totalCents)}</td>
          <td className="num">{fmtEuro(report.expenses.privateCents)}</td>
          {gratuitous && <td className="num">{fmtEuro(report.expenses.gratuitousCents ?? 0)}</td>}
          <td className="num">{fmtEuro(report.expenses.deductibleCents)}</td>
          <td />
          <td className="no-print" />
        </tr>
      </tfoot>
    </Table>
  )
}

function SplitRow({ item, gratuitous }: { item: TaxExpenseItem; gratuitous: boolean }) {
  const [open, setOpen] = useState(false)
  const stepsId = useId()
  return (
    <>
      <tr>
        <td>
          {/* M8: die Beschreibung vorn, Gruppe und Kostenart darunter statt einer Brotkrumenzeile davor */}
          <span>{item.description}</span>
          <div className="muted cell-sub">{item.group} · {item.category}</div>
          {movedInText(item) && <div className="muted fine">{movedInText(item)}</div>}
        </td>
        <td className="num">{fmtEuro(item.amountCents)}</td>
        <td className="num">{fmtEuro(item.privateCents)}</td>
        {gratuitous && <td className="num">{fmtEuro(item.gratuitousCents ?? 0)}</td>}
        <td className="num">{fmtEuro(item.deductibleCents)}</td>
        <td>{allocationLabel(item)}</td>
        <td className="no-print">
          <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Rechenweg" openLabel="Rechenweg schließen" controls={stepsId} className="btn small secondary calc-toggle" />
        </td>
      </tr>
      {open && (
        <tr id={stepsId} className="calc-steps no-print">
          <td colSpan={gratuitous ? 7 : 6}><StepList steps={item.steps} /></td>
        </tr>
      )}
    </>
  )
}

// Die verschobenen Positionen (#255, PR 4). Ein Datum außerhalb der üblichen Spanne (R-4) fragt beim Eintragen nach,
// ein späterer Wechsel des Zeitraums aber nicht (Durchsicht von PR 3, K8); deshalb steht der Satz hier.
function ShiftList({ lines }: { lines: ShiftLine[] }) {
  return (
    <ul>
      {lines.map((l) => (
        <li key={l.costItemId}>
          {l.text}.
          {l.outsideSpan && ' Das Datum liegt außerhalb der üblichen Spanne (ein Jahr vor Beginn bis drei Jahre nach Ende des Abrechnungszeitraums); bitte prüfen Sie es.'}
        </li>
      ))}
    </ul>
  )
}

// Die Einnahmen nach Zeilen der Anlage V (#312 PR 3). Zwei Betragsspalten; die der gewählten Grundlage steht vorn und
// fett, die andere gedämpft „zum Abgleich“. Die Spalte „Zeile“ nur, wenn der Vordruck des Jahres eine Nummer kennt.
function IncomeTableView({ report, basis }: { report: TaxReport; basis: Basis }) {
  const t = incomeTable(report)
  const cents = (c: number | null) => (c === null ? '–' : fmtEuro(c))
  const cols = basis === 'ist'
    ? [{ key: 'ist', head: 'eingegangen (Ist)', value: (r: { paidCents: number | null }) => r.paidCents, total: t.paidTotalCents, main: true },
       { key: 'soll', head: 'vereinbart (Soll), zum Abgleich', value: (r: { sollCents: number | null }) => r.sollCents, total: t.sollTotalCents, main: false }]
    : [{ key: 'soll', head: 'vereinbart (Soll)', value: (r: { sollCents: number | null }) => r.sollCents, total: t.sollTotalCents, main: true },
       { key: 'ist', head: 'eingegangen (Ist), zum Abgleich', value: (r: { paidCents: number | null }) => r.paidCents, total: t.paidTotalCents, main: false }]
  return (
    <Table className="stacked" aria-label="Einnahmen nach Zeilen der Anlage V">
      <thead>
        <tr>
          <th>Einnahme</th>
          {t.showsLines && <th>Zeile</th>}
          {cols.map((c) => <th key={c.key} className={`num${c.main ? '' : ' muted'}`}>{c.head}</th>)}
        </tr>
      </thead>
      <tbody>
        {t.rows.map((r) => {
          return (
            <tr key={r.key} data-row={r.key}>
              <td className={r.sub ? 'muted' : undefined}>{r.label}</td>
              {t.showsLines && <td data-label="Zeile">{r.line ?? ''}{r.line !== null && r.code !== null && <div className="muted cell-sub">Kennzahl {r.code}</div>}</td>}
              {cols.map((c) => (
                <td key={c.key} data-label={c.head} className={`num${c.main && !r.sub ? ' font-strong' : ''}${c.main && !r.sub ? '' : ' muted'}`}>
                  {cents(c.value(r))}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
      <tfoot>
        <tr data-row="total">
          <td>Summe der Einnahmen</td>
          {t.showsLines && <td data-label="Zeile">{t.totalLine ?? ''}</td>}
          {cols.map((c) => <td key={c.key} data-label={c.head} className={`num${c.main ? '' : ' muted'}`}>{fmtEuro(c.total)}</td>)}
        </tr>
      </tfoot>
    </Table>
  )
}

// „Mehr dazu“ unter der Tabelle: nur Begründungen mit Fundstelle, eingeklappt, im Druck offen (wie im Hinweis).
function IncomeMore({ year }: { year: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <div className="print:block" id={id} hidden={!open}>
        {incomeMore(year).map((m) => <p key={m} className="muted fine">{m}</p>)}
      </div>
      <div className="print:hidden">
        <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel="Mehr dazu" openLabel="Weniger" controls={id} className="btn ghost small" />
      </div>
    </>
  )
}

// Je Wohnung für die Zeilen 13 und 14 (Wohnfläche und Miete ohne Umlagen), aufklappbar, im Druck offen.
function UnitIncome({ report, year }: { report: TaxReport; year: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rows = unitRows(report)
  if (rows.length === 0) return null
  const i = anlageVLines(year)?.income
  const lines = i?.perUnit ? ` (für die Zeilen ${i.perUnit[0]} und ${i.perUnit[1]})` : ''
  return (
    <>
      <div className="print:hidden">
        <DisclosureButton open={open} onToggle={() => setOpen((o) => !o)} closedLabel={`Je Wohnung${lines}`} openLabel="Je Wohnung schließen" controls={id} className="btn ghost small" />
      </div>
      <div className="print:block" id={id} hidden={!open}>
        <h4>Je Wohnung{lines}</h4>
        <Table className="stacked" aria-label="Einnahmen je Wohnung">
          <thead>
            <tr><th>Wohnung</th><th className="num">Wohnfläche</th><th className="num">Miete ohne Umlagen</th></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.unitId}>
                <td>{u.unitName}{u.relative && <div className="muted cell-sub">an Angehörige vermietet{i?.relatives ? `: Zeile ${i.relatives.line}` : ''}</div>}</td>
                <td data-label="Wohnfläche" className="num">{u.areaM2 === null ? '–' : fmtArea(u.areaM2)}</td>
                <td data-label="Miete ohne Umlagen" className="num">{fmtEuro(u.rentCents)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="muted fine">
          Andere Räume als Wohnungen gehören zu den Einnahmen für andere Räume{i?.otherRooms ? ` (Summe in Zeile ${i.otherRooms.line})` : ''}, gesondert vermietete
          Garagen {i?.garages ? `in Zeile ${i.garages.line}` : 'zu den Einnahmen aus Garagen'}; Mietfuchs unterscheidet sie nicht von Wohnungen.
          Die Miete enthält Inklusivmieten und Zahlungen ohne vereinbarte Miete, nicht die Mieten für frühere Jahre.
        </p>
      </div>
    </>
  )
}
