import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
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
import { allocationLabel, assignedUnitItems, DEFAULT_BASIS, excludedAreaDifference, incomeCentsFor, keyNotAreaDifference, operatingPowerBalanceText, paidWithoutSettlementCents, prepaymentNote, settlementBalanceCents, settlementLine, settlementSourcesText, showsSplit, stockCarryNote, surplusCentsFor, taxHints, type Basis, movedInLines, movedInText, movedOutLabels, movedOutLines, unstatedText, type ShiftLine } from '../taxView'
import { StepList } from '../components/CalcSteps'
import Term from '../components/Term'
import { NoticeBox, TextNotice } from '../components/Notice'
import { andList } from '../../../shared/wording.ts'

type Props = { settings: Settings | null }

export default function Steuer({ settings }: Props) {
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
  const hints = data ? taxHints(data, basis, property?.kind) : []
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
      {error && <div className="error">{error}</div>}

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
            {/* #163: Die Hauptzahl ist der abziehbare Teil, der private steht klein darunter. Ohne
                Eigennutzung sind beide dieselbe Zahl, und die Karte bleibt, wie sie war. */}
            <div className="kpi">
              <div className="v">{fmtEuro(data.expenses.deductibleCents)}</div>
              <div className="l">{split ? 'Werbungskosten (abziehbar)' : 'Werbungskosten'}</div>
              {split && data.expenses.privateCents !== 0 && (
                <div className="muted" style={{ fontSize: 12 }}>
                  gesamt {fmtEuro(data.expenses.totalCents)} · davon privat {fmtEuro(data.expenses.privateCents)}
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

            <h3>Einnahmen</h3>
            <Table>
              <tbody>
                {/* Die Inklusivmiete enthält die Nebenkosten und steht deshalb nicht unter „ohne
                    Umlagen“, sondern eigens (#142). Die Summe bleibt dieselbe. */}
                <tr>
                  <td>Mieteinnahmen ohne Umlagen (Kaltmiete, vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.baseRentSollCents - data.income.inclusiveRentSollCents)}</td>
                </tr>
                {data.income.inclusiveRentSollCents !== 0 && (
                  <tr>
                    <td>Inklusivmieten (ganz oder teilweise), Nebenkosten eingeschlossen (vereinbart)</td>
                    <td className="num">{fmtEuro(data.income.inclusiveRentSollCents)}</td>
                  </tr>
                )}
                <tr>
                  <td>Umlagen / Nebenkosten-Vorauszahlungen (vereinbart)</td>
                  <td className="num">{fmtEuro(data.income.prepaymentSollCents)}</td>
                </tr>
                {data.income.flatRateSollCents > 0 && (
                  <tr>
                    <td>Betriebskostenpauschalen (vereinbart)</td>
                    <td className="num">{fmtEuro(data.income.flatRateSollCents)}</td>
                  </tr>
                )}
                <tr className="subtotal">
                  <td><strong>Summe Soll (brutto)</strong></td>
                  <td className="num"><strong>{fmtEuro(data.income.sollCents)}</strong></td>
                </tr>
                <tr>
                  {/* **Kein „davon“ mehr.** Seit das Zugeflossene nach Datum summiert wird und
                      nicht mehr über die Zeilen des Mietkontos, ist es kein Teil des Solls: Eine
                      Zahlung kann zu einem Mietverhältnis gehören, das im Jahr gar keine Zeile
                      hat. Gemessen steht dann Soll 0,00 € und eingegangen 800,00 €. Aus demselben
                      Grund fehlt hier „(Rückstand offen)“: Es verglich zwei verschiedene
                      Grundmengen. Wer wissen will, wer im Rückstand ist, fragt das Mietkonto. */}
                  <td>Tatsächlich eingegangen {year} (Zufluss)</td>
                  <td className="num">{fmtEuro(data.income.paidCents)}</td>
                </tr>
                {/* #280: Nachzahlungen und Erstattungen aus der Nebenkostenabrechnung sind Einnahmen
                    nach dem Zuflussprinzip und stecken im Zufluss; gesondert genannt, weil die
                    Anlage V sie bei den Umlagen als Saldo abfragt. **Beide Teile stehen als eigene
                    Zahl da und ergeben zusammen den Zufluss** (Durchsicht zu #328): Stünde nur der
                    Saldo daneben, trüge mancher den ganzen Zufluss in die Zeilen der Mieten und den
                    Saldo zusätzlich in Zeile 21 ein und zählte ihn doppelt. Die Zeile nennt die Seite
                    nur für Jahre, in denen sie im amtlichen Vordruck nachgesehen ist
                    (`settlementLine` in taxView.ts). */}
                {(data.income.settlementBackPaymentsCents !== 0 || data.income.settlementRefundsCents !== 0) && (
                  <>
                    <tr>
                      <td className="muted">davon Mieten und laufende Umlagen ohne Abrechnung</td>
                      <td className="num muted">{fmtEuro(paidWithoutSettlementCents(data))}</td>
                    </tr>
                    <tr>
                      <td className="muted">
                        davon Saldo der Nebenkostenabrechnung (Nachzahlungen {fmtEuro(data.income.settlementBackPaymentsCents)}{' '}
                        minus erstattete Guthaben {fmtEuro(data.income.settlementRefundsCents)})
                      </td>
                      <td className="num muted">{fmtEuro(settlementBalanceCents(data))}</td>
                    </tr>
                  </>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>Angesetzte Einnahmen ({basis === 'soll' ? 'Soll' : 'Ist'})</td>
                  <td className="num">{fmtEuro(incomeCents)}</td>
                </tr>
              </tfoot>
            </Table>

            {/* Nur auf der Ist-Grundlage: Das Soll enthält weder Nachzahlungen noch Guthaben, ein
                Hinweis auf Zeile 21 neben ihm führte in die Irre (Durchsicht zu #328). */}
            {basis === 'ist' && (data.income.settlementBackPaymentsCents !== 0 || data.income.settlementRefundsCents !== 0) && (() => {
              const line = settlementLine(year)
              const balance = fmtEuro(settlementBalanceCents(data))
              const without = fmtEuro(paidWithoutSettlementCents(data))
              const paid = fmtEuro(data.income.paidCents)
              return (
                <p className="muted fine">
                  Nachzahlungen und erstattete Guthaben aus der Nebenkostenabrechnung sind im Zufluss
                  enthalten (§ 11 Abs. 1 EStG), im vereinbarten Soll nicht.{' '}
                  {line
                    ? <>
                        In die Anlage V gehören beide Teile getrennt: <strong>{without}</strong> in die Zeilen der
                        Mieten und laufenden Umlagen (Zeilen {line.rentLines[0]} und {line.rentLines[1]} sowie
                        Zeile {line.prepaymentLine}) und der Saldo in die{' '}
                        <strong>Anlage V, Zeile {line.line} (Kennzahl {line.code})</strong>:{' '}
                        <strong>{balance}</strong> (Nachzahlungen minus Erstattungen, ein negativer Betrag mit Minuszeichen).
                        Bei Vermietung an Angehörige gilt stattdessen Zeile {line.relativesLine} (Kennzahl {line.relativesCode}),
                        die Miete und laufenden Umlagen dort in den Zeilen {line.relativesRentLine} und {line.relativesPrepaymentLine}.
                        Tragen Sie den Zufluss ({paid}) nicht zusätzlich ein, er ist die Summe beider Teile.
                      </>
                    : <>
                        Zusammen ergeben sie {balance}. Die Anlage V fragt sie bei den Umlagen gesondert ab; die
                        Zeile sehen Sie bitte im Vordruck für {year} nach. Bei den Mieten und laufenden Umlagen
                        steht dann der Zufluss ohne Abrechnung ({without}). Tragen Sie den Zufluss ({paid})
                        nicht zusätzlich ein, er ist die Summe beider Teile.
                      </>}
                </p>
              )
            })()}

            {hints.includes('paymentsMissing') && (
              <NoticeBox
                level="warning"
                title={data.income.tenanciesWithoutPayment === data.income.tenanciesWithSoll
                  ? `Für ${year} ist keine einzige Mietzahlung erfasst.`
                  : `Für ${data.income.tenanciesWithoutPayment} von ${data.income.tenanciesWithSoll} Mietverhältnissen ist ${year} keine einzige Mietzahlung erfasst.`}
                action={<>Bitte im <em>Mietkonto</em> nachtragen, bevor diese Zahl in die Anlage V geht.</>}
                more="Die angesetzten Einnahmen sind dann zu niedrig, und das sieht man der Summe nicht an."
              />
            )}

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
                  Jahres, in dem die Gemeinschaft sie bezahlt.
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
                  Ist der Betrag dem Messdienst nicht gemeldet, tragen Sie diesen Betriebsstrom selbst, und er gehört zusätzlich zu
                  Ihren Werbungskosten (§ 9 Abs. 1 Satz 1 EStG); die Übersicht zählt ihn dann nicht mit.
                </>}
                more={<>
                  {(data.operatingPowerAmbiguous ?? []).length === 1 ? 'Er zählt' : 'Sie zählen'} als dem Messdienst gemeldet, denn im
                  Zeitraum heizt eine Anlage mit Messdienst. Zugleich heizt dort eine Anlage ohne Messdienst, etwa nach einem
                  Kesseltausch. Ob der Betrag dem Messdienst gemeldet ist, kann Mietfuchs nicht erkennen.
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
                In den Werbungskosten enthaltene Arbeitskosten (§35a EStG, haushaltsnahe
                Dienstleistungen/Handwerker): <strong>{fmtEuro(data.expenses.labor35aCents)}</strong>.
                Diese werden den Mietern in der Nebenkostenabrechnung bescheinigt.
              </p>
            )}
            {/* Heizung PR 8 (N8): Brennstoff aus dem Vorrat; Abrechnung nach Verbrauch, Steuer nach Bezahltem. */}
            {stockCarryNote(data) && <p className="muted">{stockCarryNote(data)}</p>}

            {/* **Hinweis statt Automatik**, und zwar bewusst. Die Zuordnung hängt an der
                vertraglichen Fälligkeit des einzelnen Mietverhältnisses, und der BFH verlangt,
                dass Fälligkeit und Zahlung beide in den kurzen Zeitraum fallen. Mietfuchs kennt
                die Fälligkeit nicht, und ein Feld dafür einzuführen hieße, eine Zahl der
                Steuererklärung davon abhängig zu machen, dass jeder Nutzer es richtig ausfüllt.
                Die Aufteilung gemischt genutzter Gebäude (#163) rechnet dagegen, weil alle Angaben
                dafür im Bestand stehen.
                **Das Beispiel ist bewusst die Januarmiete und nicht die Dezembermiete.** Die
                Dezembermiete ist nach § 556b Abs. 1 BGB im Dezember fällig; geht sie im Januar
                ein, liegt die Fälligkeit weit außerhalb des kurzen Zeitraums, und die Regel
                greift gerade nicht. Der häufige und für Mietfuchs ungünstige Fall ist der
                umgekehrte: der Dauerauftrag, der die Januarmiete Ende Dezember bucht. Dort liegen
                Fälligkeit und Zahlung beide im Zeitraum, und die Einnahme des alten Jahres ist zu
                hoch. */}
            {/* #96: Kopfzeilen der Anlage V, die am Mietmodell hängen. Belegt am Vordruck 2025 und der
                Anleitung 2024; die Pauschale nennt die Anleitung nicht ausdrücklich. */}
            {hints.includes('inclusiveLine24') && (
              <NoticeBox
                level="hint"
                title="Zeile 24 der Anlage V."
                action="Tragen Sie dort eine 1 ein; die ganze Miete gehört dann zu den Mieteinnahmen, und für diese Mietverhältnisse sind keine Umlagen in den Zeilen 20 und 21 einzutragen."
                more="Bei einer Inklusivmiete sind die Nebenkosten nicht gesondert vereinbart."
              />
            )}
            {hints.includes('inclusiveLine24Mixed') && (
              <NoticeBox
                level="hint"
                title="Zeile 24 der Anlage V."
                action="Bei gemischten Verträgen klären Sie den Eintrag am besten mit Ihrem Steuerberater."
                more="Eine Inklusivmiete gilt hier nur für einen Teil der Mietverhältnisse oder nur für einen Teil der Nebenkosten (nur kalt oder nur die Heizung). Die Zeile fragt für das ganze Objekt, ob Nebenkosten gesondert vereinbart sind."
              />
            )}
            {hints.includes('flatRateLine20') && (
              <NoticeBox
                level="hint"
                title="Zeile 20 der Anlage V."
                action="Eine Betriebskostenpauschale ist eine Einnahme wie die Miete."
                more="Nach dem Wortlaut gehört sie zu den laufend vereinnahmten Umlagen in Zeile 20; ausdrücklich nennt die Anleitung die Pauschale nicht."
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
                </>}
              />
            )}
            {hints.includes('turnOfYear') && (
              <NoticeBox
                level="hint"
                title="Am Jahreswechsel bitte prüfen."
                action="Prüfen Sie Mieten, die kurz vor oder nach dem Jahreswechsel eingegangen sind; Mietfuchs entscheidet das nicht selbst."
                more={<>
                  Mietfuchs ordnet jede Zahlung dem Jahr
                  ihres Eingangs zu. Für regelmäßig wiederkehrende Einnahmen wie die Miete gibt es davon
                  eine Ausnahme: Fließen sie kurze Zeit — nach der Rechtsprechung bis zu zehn Tage — vor
                  oder nach dem Jahreswechsel und sind sie in dieser Zeit auch fällig, gehören sie in das
                  Jahr, zu dem sie wirtschaftlich zählen (§ 11 Abs. 1 Satz 2 EStG). Am häufigsten trifft
                  das die Januarmiete, die ein Dauerauftrag schon Ende Dezember bucht: Sie gehört ins
                  neue Jahr, steht hier aber im alten.
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
            {hints.includes('mixedUseChangedInYear') && (
              <NoticeBox
                level="warning"
                title="Eine selbstgenutzte Einheit war in diesem Jahr auch vermietet."
                action="Für die Zeit der Vermietung sind ihre Kosten abziehbar; bitte rechnen Sie diesen Teil anteilig nach."
                more={<>
                  Die Nutzung einer Einheit hat in
                  Mietfuchs keinen Stichtag; die Aufteilung nach Fläche ist deshalb nicht nach Tagen gerechnet und zählt
                  die Einheit das ganze Jahr als privat.
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
                action="Abschreibung, Schuldzinsen, die Verteilung nach § 82b EStDV und die Kürzung bei verbilligter Vermietung tragen Sie selbst ein; diese Angaben kennt Mietfuchs nicht."
                more={<>
                  Nicht gerechnet werden: die Abschreibung (AfA) des Gebäudes, die ebenfalls nur anteilig abziehbar
                  ist (Zeilen 33 und 34); Schuldzinsen, die der Zuordnung des Darlehens folgen und nicht der Fläche; die
                  Verteilung größeren Erhaltungsaufwands auf mehrere Jahre nach § 82b EStDV; und die Kürzung bei
                  verbilligter Vermietung, für die die Aufwendungen voll eingetragen und nur in den Zeilen 87 und 88
                  gekürzt werden.
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
  return (
    <Table>
      <thead>
        <tr>
          <th>Position</th>
          <th className="num">Gesamt</th>
          <th className="num">privat</th>
          <th className="num">abziehbar</th>
          <th>Zuordnung</th>
          <th className="no-print" />
        </tr>
      </thead>
      <tbody>
        {items.map((x) => <SplitRow key={x.costItemId} item={x} />)}
      </tbody>
      <tfoot>
        <tr>
          <td>Summe Werbungskosten</td>
          <td className="num">{fmtEuro(report.expenses.totalCents)}</td>
          <td className="num">{fmtEuro(report.expenses.privateCents)}</td>
          <td className="num">{fmtEuro(report.expenses.deductibleCents)}</td>
          <td />
          <td className="no-print" />
        </tr>
      </tfoot>
    </Table>
  )
}

function SplitRow({ item }: { item: TaxExpenseItem }) {
  const [open, setOpen] = useState(false)
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
        <td className="num">{fmtEuro(item.deductibleCents)}</td>
        <td>{allocationLabel(item)}</td>
        <td className="no-print">
          <button type="button" className="btn small secondary calc-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Rechenweg schließen' : 'Rechenweg'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="calc-steps no-print">
          <td colSpan={6}><StepList steps={item.steps} /></td>
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
