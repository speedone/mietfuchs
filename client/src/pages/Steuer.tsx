import { Fragment, useCallback, useEffect, useState } from 'react'
import type { Settings, TaxExpenseItem, TaxReport } from '../types'
import { api, fmtArea, fmtEuro } from '../api'
import { useYear, YEAR_OPTIONS } from '../year'
import { useProperty, withProperty } from '../property'
import { effectiveLandlord, letterhead } from '../landlord'
import PageHeader from '../components/PageHeader'
import Table from '../components/Table'
import { allocationLabel, DEFAULT_BASIS, excludedAreaDifference, incomeCentsFor, keyNotAreaDifference, prepaymentNote, showsSplit, surplusCentsFor, taxHints, type Basis } from '../taxView'
import { StepList } from '../components/CalcSteps'
import Term from '../components/Term'

type Props = { settings: Settings | null }

export default function Steuer({ settings }: Props) {
  const { year, setYear } = useYear()
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

  function print() {
    const prevTitle = document.title
    document.title = `Steuerübersicht Anlage V ${year}`.replace(/[\\/:*?"<>|]/g, '-')
    const restore = () => { document.title = prevTitle; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    setTimeout(() => window.print(), 60)
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
  // Teilweise Eigennutzung (#163): Spalten privat und abziehbar nur, wenn es etwas Privates gibt.
  const split = data ? showsSplit(data) : false
  const keyDiff = data ? keyNotAreaDifference(data) : null
  const excludedDiff = data ? excludedAreaDifference(data) : null

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
            <div className="muted" style={{ marginBottom: 8 }}>
              {letterhead(landlord?.landlordName, property)}
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
            </Table>

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
              </Table>
            )}

            {/* #143: Die Zuführung zur Erhaltungsrücklage steht neben den Werbungskosten. Auch im
                Druck, damit der Betrag beim Steuerberater nicht als vergessen gilt. */}
            {hints.includes('reserveContribution') && (
              <div className="notice" style={{ marginTop: 10 }}>
                <strong>{data.reserveContributionCents < 0
                  // Saldiert negativ, etwa durch eine Rückzahlung oder Korrektur: dann ist es keine Zuführung.
                  ? 'Erhaltungsrücklage, saldiert (Rückzahlung oder Korrektur)'
                  : 'Zuführung zur Erhaltungsrücklage'}: {fmtEuro(data.reserveContributionCents)}</strong>, nicht in den
                Werbungskosten enthalten. Sie ist erst abziehbar, wenn und soweit die Gemeinschaft das Geld für
                Erhaltungsmaßnahmen ausgibt; erst dann steht fest, ob es Erhaltungsaufwand oder Herstellungskosten sind
                (BFH, Urteil vom 14.01.2025, IX R 19/24). Die Ausgaben aus der Rücklage nennt die Hausgeldabrechnung des
                Jahres, in dem die Gemeinschaft sie bezahlt.
              </div>
            )}
            {hints.includes('reserveSuspected') && (
              <div className="notice" style={{ marginTop: 10 }}>
                {data.reserveSuspects.map((r) => `„${r.description}“ (${fmtEuro(r.amountCents)})`).join(', ')}{' '}
                {data.reserveSuspects.length === 1 ? 'sieht' : 'sehen'} nach einer Zuführung zur Erhaltungsrücklage aus und
                {data.reserveSuspects.length === 1 ? ' steht' : ' stehen'} oben in den Werbungskosten. Ist es die Zuführung,
                stellen Sie unter <em>Kosten</em> die Kostenart „Zuführung Erhaltungsrücklage“ ein: Abziehbar ist sie erst,
                wenn die Gemeinschaft das Geld ausgibt (BFH, Urteil vom 14.01.2025, IX R 19/24).
              </div>
            )}

            <h3 style={{ marginTop: 18 }}>Ergebnis</h3>
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
              <p className="muted" style={{ marginTop: 14 }}>
                In den Werbungskosten enthaltene Arbeitskosten (§35a EStG, haushaltsnahe
                Dienstleistungen/Handwerker): <strong>{fmtEuro(data.expenses.labor35aCents)}</strong>.
                Diese werden den Mietern in der Nebenkostenabrechnung bescheinigt.
              </p>
            )}

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
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                <strong>Zeile 24 der Anlage V.</strong> Bei einer Inklusivmiete sind die Nebenkosten nicht gesondert vereinbart. Tragen Sie dort eine 1 ein; die ganze Miete gehört dann zu den Mieteinnahmen, und für diese Mietverhältnisse sind keine Umlagen in den Zeilen 20 und 21 einzutragen.
              </p>
            )}
            {hints.includes('inclusiveLine24Mixed') && (
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                <strong>Zeile 24 der Anlage V.</strong> Eine Inklusivmiete gilt hier nur für einen Teil der Mietverhältnisse oder nur für einen Teil der Nebenkosten (nur kalt oder nur die Heizung). Die Zeile fragt für das ganze Objekt, ob Nebenkosten gesondert vereinbart sind; bei gemischten Verträgen klären Sie den Eintrag am besten mit Ihrem Steuerberater.
              </p>
            )}
            {hints.includes('flatRateLine20') && (
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                <strong>Zeile 20 der Anlage V.</strong> Eine Betriebskostenpauschale ist eine Einnahme wie die Miete. Nach dem Wortlaut gehört sie zu den laufend vereinnahmten Umlagen in Zeile 20; ausdrücklich nennt die Anleitung die Pauschale nicht.
              </p>
            )}
            {hints.includes('etwHousingMoney') && (
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                <strong>Eigentumswohnung: abgeflossen ist das gezahlte Hausgeld.</strong> Werbungskosten sind im Jahr
                der Zahlung anzusetzen (§ 11 Abs. 2 EStG). Das sind die Hausgeld-Vorschüsse dieses Jahres und eine
                Nachzahlung aus der Abrechnung des Vorjahres, nicht die Beträge der Hausgeldabrechnung dieses Jahres.
                Mietfuchs setzt die Kosten mit dem Jahr der Kostenposition an; gleichen Sie die Zahlen deshalb mit Ihren
                Kontoauszügen ab.
              </p>
            )}
            {hints.includes('turnOfYear') && (
              <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
                <strong>Am Jahreswechsel bitte prüfen.</strong> Mietfuchs ordnet jede Zahlung dem Jahr
                ihres Eingangs zu. Für regelmäßig wiederkehrende Einnahmen wie die Miete gibt es davon
                eine Ausnahme: Fließen sie kurze Zeit — nach der Rechtsprechung bis zu zehn Tage — vor
                oder nach dem Jahreswechsel und sind sie in dieser Zeit auch fällig, gehören sie in das
                Jahr, zu dem sie wirtschaftlich zählen (§ 11 Abs. 1 Satz 2 EStG). Am häufigsten trifft
                das die Januarmiete, die ein Dauerauftrag schon Ende Dezember bucht: Sie gehört ins
                neue Jahr, steht hier aber im alten. Mietfuchs entscheidet das nicht selbst.
              </p>
            )}

            {/* **Zwei verschiedene Lagen, zwei verschiedene Sätze** (#68). Vorher gab es nur
                einen, und er fragte das zweiwertige „nicht vermietet" ab; damit schlug eine
                ausdrücklich ausgenommene Wohnung als Eigennutzung durch, und der Vermieter sollte
                einen privaten Anteil herausrechnen, den es nicht gibt.
                **Genannt werden Quadratmeter und nicht nur ein Prozentsatz.** Genau diese beiden
                Zahlen fragt die Anlage V im Kopf ab, und ein bloßer Prozentsatz lädt dazu ein, den
                Rest für den abziehbaren Anteil zu halten. Das stimmt nur, solange es keine
                Wohnungen außerhalb der Abrechnungseinheit gibt; deshalb steht der Vorbehalt
                daneben, sobald es sie gibt. */}
            {data.selfOccupiedExists && (
              <div className="notice" style={{ marginTop: 14 }}>
                <strong>Gemischt genutztes Gebäude.</strong> Von {fmtArea(data.totalAreaM2)} Gesamtfläche
                sind <strong>{fmtArea(data.selfUsedAreaM2)}</strong> selbstgenutzt und damit privat
                {sharePct !== null && <> ({sharePct.toLocaleString('de-DE')} %)</>}.
                Werbungskosten sind nur abziehbar, soweit sie auf den vermieteten Teil entfallen
                (§ 9 Abs. 1, § 12 Nr. 1 EStG). Diese Übersicht teilt deshalb jede Position auf: Was einer
                Einheit direkt zugeordnet ist, gehört ganz zu ihr; Kosten des ganzen Gebäudes werden nach dem
                Verhältnis der Wohn- und Nutzflächen aufgeteilt (BFH, Urteil vom 24.06.2008, IX R 26/06); bei
                umlagefähigen Kosten gilt der Eigenanteil aus der Nebenkostenabrechnung, damit beide dasselbe
                sagen. Zusammen sind <strong>{fmtEuro(data.expenses.privateCents)}</strong> privat
                und <strong>{fmtEuro(data.expenses.deductibleCents)}</strong> abziehbar.{' '}
                <Term id="mixedUse">Was heißt das?</Term>
              </div>
            )}
            {hints.includes('mixedUseSplit') && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                <strong>In der Anlage V.</strong> Zeile 11 fragt die Gesamtwohnfläche, Zeile 12 den
                eigengenutzten oder unentgeltlich überlassenen Wohnraum darin. Dorthin gehört nur Wohnfläche:
                Garagen, Keller und andere Zubehörräume zählen nicht mit; für die Aufteilung der Gebäudekosten zählt
                eine eingetragene Fläche dagegen, denn maßgeblich sind Wohn- und Nutzflächen. Die Werbungskosten
                gehören in die Zeilen „durch direkte Zuordnung ermittelt“ und „durch verhältnismäßige Zuordnung
                ermittelt“, dort mit Gesamtbetrag und abzugsfähigem Anteil; beides steht oben je Position. Teilen
                Sie zum ersten Mal verhältnismäßig auf, erläutern Sie Maßstab und Zuordnung in einer gesonderten
                Aufstellung; dafür taugt der Ausdruck dieser Übersicht samt Rechenweg. Bitte stimmen Sie die
                Aufteilung mit Ihrem Steuerberater ab.
              </p>
            )}
            {hints.includes('mixedUseKeyNotArea') && keyDiff && (
              <div className="notice" style={{ marginTop: 10 }}>
                Bei {keyDiff.count === 1 ? 'einer Position' : `${keyDiff.count} Positionen`} verteilt die
                Nebenkostenabrechnung nach Personen, Wohneinheiten oder vereinbarten Anteilen, und der private Teil
                folgt diesem Schlüssel. Nach Fläche wären es zusammen <strong>{fmtEuro(keyDiff.differenceCents)}</strong> anders.
                Eine häufige Ursache ist Leerstand: Beim Personenschlüssel trägt eine leere Wohnung keine Personen,
                ihr Anteil fällt dann auf die Personen der übrigen und damit auch auf Ihre. Kosten einer leerstehenden
                Wohnung bleiben aber abziehbar, solange Sie sie vermieten wollen (Vermietungsabsicht).
                Für Kosten, die sich nicht direkt zuordnen lassen, nennt der Bundesfinanzhof das Verhältnis der Wohn-
                und Nutzflächen als Regelmaßstab; ob ein Umlageschlüssel als Maßstab anerkannt wird, ist nicht
                entschieden. Mietfuchs übernimmt den Eigenanteil der Abrechnung, damit Abrechnung und Steuer dasselbe
                sagen; den Vergleich nach Fläche zeigt der Rechenweg der Position. Bitte klären Sie den Maßstab mit
                Ihrem Steuerberater.
              </div>
            )}
            {hints.includes('mixedUseExcludedArea') && excludedDiff && (
              <div className="notice" style={{ marginTop: 10 }}>
                Zum Gebäude gehören Einheiten außerhalb der Abrechnungseinheit. Die Nebenkostenabrechnung verteilt
                nur über die Abrechnungseinheit; ihr Eigenanteil behandelte die Fläche dieser Einheiten wie privat.
                Für die Steuer teilt diese Übersicht deshalb {excludedDiff.count === 1 ? 'eine Position' : `${excludedDiff.count} Positionen`} nach
                der Fläche über das ganze Gebäude auf; gegenüber der Abrechnung sind das
                zusammen <strong>{fmtEuro(excludedDiff.differenceCents)}</strong> weniger privat. Den Eigenanteil laut
                Abrechnung zeigt der Rechenweg der Position.
              </div>
            )}
            {hints.includes('mixedUseClosedItemsChanged') && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                {data.closedItemsChanged === 1 ? 'Eine Position wurde' : `${data.closedItemsChanged} Positionen wurden`} nach dem Abschluss der Abrechnung {year} erfasst
                oder geändert. Sie {data.closedItemsChanged === 1 ? 'steht' : 'stehen'} nicht so auf dem Papier beim Mieter; ihren privaten Teil rechnet die
                Übersicht deshalb mit den heutigen Daten.
              </p>
            )}
            {hints.includes('mixedUseAreaMissing') && (
              <div className="notice" style={{ marginTop: 10 }}>
                Mindestens eine Position ließ sich nicht aufteilen, weil für eine betroffene Einheit keine Fläche
                hinterlegt ist. Sie steht ungekürzt bei den abziehbaren Werbungskosten. Bitte tragen Sie die Fläche
                in den Stammdaten ein.
              </div>
            )}
            {hints.includes('mixedUseDirectOutside') && (
              <div className="notice" style={{ marginTop: 10 }}>
                Mindestens eine Position ist einer Einheit außerhalb der Abrechnungseinheit zugeordnet. Mietfuchs
                zählt sie als abziehbar. Nutzen Sie diese Einheit selbst, stellen Sie sie in den Stammdaten auf
                Eigennutzung; sonst sind die abziehbaren Werbungskosten zu hoch.
              </div>
            )}
            {hints.includes('mixedUseChangedInYear') && (
              <div className="notice" style={{ marginTop: 10 }}>
                Eine selbstgenutzte Einheit war in diesem Jahr auch vermietet. Die Nutzung einer Einheit hat in
                Mietfuchs keinen Stichtag; die Aufteilung nach Fläche ist deshalb nicht nach Tagen gerechnet und zählt
                die Einheit das ganze Jahr als privat. Für die Zeit der Vermietung sind ihre Kosten abziehbar; bitte
                rechnen Sie diesen Teil anteilig nach.
              </div>
            )}
            {hints.includes('mixedUseClosedChanged') && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Die Abrechnung {year} ist abgeschlossen. Für den privaten Teil der umlagefähigen Kosten gilt der eingefrorene Stand,
                auch wenn die heutige Rechnung etwas anderes ergäbe oder die Abrechnung den Eigenanteil je Position
                noch nicht festhielt; so nennt die Übersicht dieselbe Zahl wie das Papier beim Mieter.
              </p>
            )}
            {hints.includes('mixedUseLabor35a') && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Bei Positionen mit Lohnanteil (§ 35a EStG) gehört der private Teil nicht zu den Werbungskosten. Ob
                Sie für den Lohnanteil, der auf Ihre eigene Wohnung entfällt, die Steuerermäßigung in Ihrer eigenen Steuererklärung
                nutzen können, klären Sie bitte mit Ihrem Steuerberater; Mietfuchs rechnet sie nicht aus.
              </p>
            )}
            {hints.includes('mixedUseNotCalculated') && (
              <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                Nicht gerechnet werden: die Abschreibung (AfA) des Gebäudes, die ebenfalls nur anteilig abziehbar
                ist (Zeilen 33 und 34); Schuldzinsen, die der Zuordnung des Darlehens folgen und nicht der Fläche; die
                Verteilung größeren Erhaltungsaufwands auf mehrere Jahre nach § 82b EStDV; und die Kürzung bei
                verbilligter Vermietung, für die die Aufwendungen voll eingetragen und nur in den Zeilen 87 und 88
                gekürzt werden. Diese Angaben kennt Mietfuchs nicht.
              </p>
            )}

            {/* Der dritte Zustand, den es vorher nicht gab. Hier fallen zwei verschiedene Bestände
                zusammen, und Mietfuchs unterscheidet sie bewusst nicht (die Begründung steht in
                calc.ts): die getrennt abgerechnete Gewerbeeinheit und die eigene Wohnung aus einem
                alten Bestand. Der Satz fragt deshalb, statt zu behaupten. */}
            {data.excludedExists && (
              <div className="notice" style={{ marginTop: 14 }}>
                <strong>Wohnungen außerhalb der Abrechnungseinheit.</strong> Diese Wohnungen sind weder
                als vermietet noch als selbstgenutzt gekennzeichnet, und deshalb weiß Mietfuchs nicht, wie
                sie steuerlich zu behandeln sind. Nutzen Sie eine davon selbst, stellen Sie sie in den <em>Stammdaten</em> auf
                <em> Eigennutzung</em>; dann teilt diese Übersicht die Werbungskosten auf. Sind sie getrennt
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
              </div>
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
                schützen soll. „Können" statt „gehen", weil eine ausgenommene Wohnung ohne
                erfasste Fläche beide Grundmengen gleich lässt. */}
            {data.selfOccupiedExists && data.excludedExists && (
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
          <span className="muted">{item.group} · {item.category} · </span><span>{item.description}</span>
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
