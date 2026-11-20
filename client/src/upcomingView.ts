// „Demnächst fällig“ im Cockpit (#190): aus den Einträgen des Servers (GET /api/upcoming, server/src/upcomingDeadlines.ts)
// Texte, Stufe und Sprungziel, ohne DOM prüfbar (upcomingView.test.ts). Welche Fristen in der Liste stehen und warum,
// entscheidet der Server; hier steht nur, wie sie heißen.
//
// Recht, wie es die Sätze sagen: § 556 Abs. 3 Satz 2, 3, 5 und 6 BGB (Wortlaut am 20.11.2026 gelesen); § 37 Abs. 1 MessEG
// und § 35 MessEV wie im Lexikon „Eichfrist“. Zur Kaution: § 551 BGB nennt keine Frist; dass dem Vermieter eine
// angemessene, nicht allgemein bestimmbare Frist zusteht, sagt der Bundesgerichtshof (VIII ZR 71/05, Rn. 9 f.), hier
// gelesen über die Zitate in späteren Urteilen des Senats (VIII ZR 141/17, VIII ZR 184/23). Eine Zahl von Monaten nennt
// Mietfuchs bewusst nicht.
//
// Mieterhöhung (#191, PR 4): §§ 557 Abs. 3, 557a, 557b, 558, 558b BGB wie im Entwurf
// docs/superpowers/specs/2026-11-20-mieterhoehung-design.md; Zahlen der Fristen nennt der Server als Datum, hier stehen
// nur die Regeln in Worten. Schweigen ist keine Zustimmung (S8), und ob eine Klage sinnvoll ist, bewertet Mietfuchs nicht.
import { fmtDate, fmtEuro } from './api'
import type { JumpTarget } from './focus'
import type { NavTarget } from './nav'
import type { PeriodKey, UpcomingDeadline, UpcomingDeadlines } from './types'
import { SENT_AT_TARGET } from './jumpTargets'

// `overdue`: die Frist ist abgelaufen; `open`: zu erledigen; `info`: nur zur Kenntnis (Einwendungsfrist der Mieter,
// Staffelstufe, mögliche Mieterhöhung, verstrichene Klagefrist).
export type UpcomingLevel = 'overdue' | 'open' | 'info'
const LEVEL_TEXT: Record<UpcomingLevel, string> = { overdue: 'abgelaufen', open: 'offen', info: 'zur Information' }

// `period`: erst in diesen Zeitraum wechseln, dann springen (die Abrechnung gehört zu ihrem Zeitraum).
export type UpcomingAction = { label: string; tab: NavTarget; focus?: JumpTarget; period?: PeriodKey }
export type UpcomingRow = { id: string; level: UpcomingLevel; levelText: string; title: string; when: string; detail: string; action: UpcomingAction }

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86400000
}

// Wie weit ein Tag von heute entfernt ist, in Worten.
export function dueText(date: string, today: string): string {
  const days = Math.round(dayNumber(date) - dayNumber(today))
  if (days === 0) return 'heute'
  if (days === 1) return 'morgen'
  if (days > 1) return `in ${days} Tagen`
  return days === -1 ? 'seit 1 Tag' : `seit ${-days} Tagen`
}

function rowOf(item: UpcomingDeadline, today: string): UpcomingRow {
  const date = fmtDate(item.date)
  const overdue = item.date < today
  const row = (level: UpcomingLevel, rest: Omit<UpcomingRow, 'id' | 'level' | 'levelText'>): UpcomingRow =>
    ({ id: item.id, level, levelText: LEVEL_TEXT[level], ...rest })
  switch (item.kind) {
    case 'settlement': {
      const state = item.closed
        ? 'Abgeschlossen, aber nicht als versendet markiert. Ist sie verschickt, tragen Sie das Versanddatum ein.'
        : 'Noch nicht abgeschlossen.'
      const rule = overdue
        ? 'Nach Ablauf der Frist können Sie eine Nachzahlung nur verlangen, wenn Sie die Verspätung nicht zu vertreten haben (§ 556 Abs. 3 Satz 3 BGB); ein Guthaben der Mieter bleibt fällig.'
        : `Die Abrechnung muss den Mietern bis zum ${date} zugehen (§ 556 Abs. 3 Satz 2 BGB); es zählt der Zugang, nicht das Absenden.`
      return row(overdue ? 'overdue' : 'open', {
        title: `Abrechnung ${item.label} versenden`,
        when: overdue ? `Frist am ${date} abgelaufen` : `Frist bis ${date} (${dueText(item.date, today)})`,
        detail: `${state} ${rule}`,
        action: item.closed
          ? { label: 'Versanddatum eintragen', tab: 'abrechnung', focus: SENT_AT_TARGET, period: item.period }
          : { label: 'Zur Abrechnung', tab: 'abrechnung', period: item.period },
      })
    }
    case 'objection':
      return row('info', {
        title: `Einwendungsfrist der Mieter, Abrechnung ${item.label}`,
        when: `bis etwa ${date} (${dueText(item.date, today)})`,
        detail: `Versendet am ${fmtDate(item.sentAt)}. Einwendungen gegen die Abrechnung müssen die Mieter bis zum Ablauf des zwölften Monats nach Zugang mitteilen; danach sind sie ausgeschlossen, wenn die Mieter die Verspätung zu vertreten haben (§ 556 Abs. 3 Satz 5 und 6 BGB). ` +
          'Den Zugang kennt Mietfuchs nicht: Gerechnet ist ab dem Versanddatum bis zum Monatsende. Geht die Abrechnung später zu oder fällt das Ende auf einen Sonnabend, Sonntag oder Feiertag, endet die Frist später.',
        action: { label: 'Zur Abrechnung', tab: 'abrechnung', period: item.period },
      })
    case 'deposit':
      return row('open', {
        title: 'Kaution abrechnen',
        when: `ausgezogen am ${date}`,
        detail: `Bei Ihnen liegen noch ${fmtEuro(item.balanceCents)} von ${item.tenantName}. Eine feste Frist nennt das Gesetz nicht; nach dem Bundesgerichtshof haben Sie nach dem Ende des Mietverhältnisses eine angemessene Frist, um abzurechnen, und wie lang sie ist, hängt vom Einzelfall ab (Urteil vom 18.01.2006, VIII ZR 71/05).`,
        action: { label: 'Kaution öffnen', tab: 'stammdaten', focus: { kind: 'deposit', tenancyId: item.tenancyId } },
      })
    case 'calibration':
      return row(overdue ? 'overdue' : 'open', {
        title: `Eichfrist ${item.meterName}`,
        when: overdue ? `am ${date} abgelaufen` : `endet am ${date} (${dueText(item.date, today)})`,
        detail: 'Danach darf der Zähler nicht ungeeicht verwendet werden (§ 37 Abs. 1 MessEG). Lassen Sie ihn rechtzeitig tauschen oder eichen. Hat der Messdienst die Frist im Stichprobenverfahren verlängern lassen (§ 35 MessEV), tragen Sie das verlängerte Jahr am Zähler ein.',
        action: { label: 'Zähler öffnen', tab: 'zaehler', focus: { kind: 'meter', id: item.meterId } },
      })
    case 'rentStep': {
      const last = item.last ? ' Es ist die letzte vereinbarte Stufe.' : ''
      const after = item.comparisonFrom
        ? ` Danach ist eine Erhöhung bis zur ortsüblichen Vergleichsmiete möglich (§ 557a Abs. 2 Satz 2, § 558 BGB); ein Verlangen kann frühestens am ${fmtDate(item.comparisonFrom)} zugehen.`
        : ''
      return row('info', {
        title: `Neue Stufe der Staffelmiete, ${item.unitName}`,
        when: `ab ${date} (${dueText(item.date, today)})`,
        detail: `${item.tenantName} zahlt ab dann ${fmtEuro(item.cents)} Kaltmiete${item.fromCents !== null ? ` statt ${fmtEuro(item.fromCents)}` : ''}. Die Stufe ist vereinbart und gilt ohne Erklärung (§ 557a BGB).${last}${after}`,
        action: rentIncreaseAction('Mieterhöhung öffnen', item.tenancyId),
      })
    }
    case 'rentIncrease': {
      const reached = item.date <= today
      const when = reached ? 'schon jetzt' : `frühestens am ${date}`
      const effective = fmtDate(`${item.effectiveFrom}-01`)
      const text = item.increaseKind === 'index'
        ? `Eine Erklärung an ${item.tenantName}, die Miete an den Verbraucherpreisindex anzupassen (§ 557b BGB), kann ${when} zugehen; die geänderte Miete wäre dann ab dem ${effective} zu zahlen. Den neuen Indexwert geben Sie im Fenster „Mieterhöhung“ ein.`
        : `Ein Verlangen an ${item.tenantName}, der Erhöhung bis zur ortsüblichen Vergleichsmiete zuzustimmen (§ 558 BGB), kann ${when} zugehen; die erhöhte Miete wäre dann ab dem ${effective} geschuldet. Wie viel möglich ist, rechnet das Fenster „Mieterhöhung“ aus Vergleichsmiete und Kappungsgrenze.`
      return row('info', {
        title: `${item.increaseKind === 'index' ? 'Indexanpassung' : 'Mieterhöhung'} möglich, ${item.unitName}`,
        when: reached ? `Zugang möglich seit ${date}` : `Zugang ab ${date} (${dueText(item.date, today)})`,
        detail: item.exclusionOpen ? `${text} Vorher ist am Mietverhältnis noch anzugeben, ob der Vertrag Mieterhöhungen ausschließt (§ 557 Abs. 3 BGB).` : text,
        action: rentIncreaseAction('Mieterhöhung öffnen', item.tenancyId),
      })
    }
    case 'rentConsent': {
      const received = fmtDate(item.receivedOn)
      const suitEnd = fmtDate(item.suitEnd)
      const action = rentIncreaseAction('Antwort eintragen', item.tenancyId)
      if (item.stage === 'running') {
        return row('open', {
          title: `Zustimmungsfrist zur Mieterhöhung, ${item.unitName}`,
          when: `bis ${fmtDate(item.consentEnd)} (${dueText(item.consentEnd, today)})`,
          detail: `Das Verlangen ist ${item.tenantName} am ${received} zugegangen. Zustimmen kann der Mieter bis zum Ablauf des zweiten Kalendermonats nach dem Zugang (§ 558b Abs. 1 BGB). Tragen Sie die Antwort ein, sobald sie vorliegt; mit der Zustimmung trägt Mietfuchs die neue Miete in die Kaltmiete-Staffel ein.`,
          action,
        })
      }
      if (item.stage === 'suit') {
        return row('overdue', {
          title: `Zustimmung zur Mieterhöhung fehlt, ${item.unitName}`,
          when: `Zustimmungsfrist am ${fmtDate(item.consentEnd)} abgelaufen, Klagefrist bis ${suitEnd}`,
          detail: `Zum Verlangen, das ${item.tenantName} am ${received} zugegangen ist, ist keine Antwort eingetragen. Schweigen ist keine Zustimmung. Stimmt der Mieter nicht zu, kann auf Zustimmung geklagt werden, bis zum ${suitEnd} (§ 558b Abs. 2 BGB). Ob eine Klage sinnvoll ist, prüft Mietfuchs nicht. Liegt eine Antwort vor, tragen Sie sie ein.`,
          action,
        })
      }
      return row('info', {
        title: `Klagefrist zur Mieterhöhung verstrichen, ${item.unitName}`,
        when: `am ${suitEnd} abgelaufen`,
        detail: `Zum Verlangen, das ${item.tenantName} am ${received} zugegangen ist, ist keine Antwort eingetragen, und die Frist für eine Klage auf Zustimmung (§ 558b Abs. 2 BGB) ist verstrichen. Schweigen ist keine Zustimmung; ohne sie gilt die erhöhte Miete nicht. Tragen Sie die Antwort ein oder nehmen Sie das Verlangen zurück, dann verschwindet der Eintrag.`,
        action,
      })
    }
  }
}

// Das Seitenfenster „Mieterhöhung“ des Mietverhältnisses in den Stammdaten.
const rentIncreaseAction = (label: string, tenancyId: string): UpcomingAction => ({ label, tab: 'stammdaten', focus: { kind: 'rentIncrease', tenancyId } })

// Die Zeilen in der Reihenfolge des Servers (nach Tag).
export function upcomingRows(list: UpcomingDeadlines): UpcomingRow[] {
  return list.items.map((item) => rowOf(item, list.today))
}
