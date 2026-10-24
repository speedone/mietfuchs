// Hinweis (#346, Schritt 10; Spezifikation Abschnitt 6, UI-Durchsicht M8): fetter Titel, der Text,
// „Hier beheben →“, und nur die Begründungen aus Fundstellen (Normketten, Urteile, Drucksachen) unter
// „Mehr dazu“. Folgen, Kürzungen, Beträge, Daten und Aufforderungen bleiben immer sichtbar (Durchsicht
// M1, M2), ein Fehler ganz (#236). Die Stufe steht nicht nur in der Farbe, sondern auch als Zeichen und
// als Wort; das Wort liest ein Vorleser mit („Warnung: …“).
//
// `NoticeBox` setzt die Teile zusammen, `CalcNotice` macht das aus einem Hinweis der Berechnung
// (`Notice` aus shared/types.ts): dessen Text wird nur in Sätze zerlegt (noticeText.ts), der Wortlaut
// bleibt. „Mehr dazu“ ist eingeklappt, wird aber immer mitgedruckt, denn was am Bildschirm aufklappbar
// ist, muss auf dem Papier vollständig stehen.
import { Fragment, useId, useState, type ReactNode } from 'react'
import type { Notice, NoticeLevel } from '../types'
import { NOTICE_LEVEL_LABELS, noticeClass } from '../notices'
import { splitNoticeText } from '../noticeText'
import Term from './Term'

// Zeichen je Stufe, mit U+FE0E als Text und nicht als buntes Emoji.
export const NOTICE_SYMBOLS: Record<NoticeLevel, string> = {
  error: '✖︎',
  warning: '⚠︎',
  hint: 'ℹ︎',
  info: 'ℹ︎',
}

type Fix = { label: string, onClick: () => void }

export function NoticeBox({ level, title, context, action, children, more, fix, className }: {
  level: NoticeLevel
  title?: ReactNode
  // Wovon die Rede ist, vor dem Satz („Heizanlage „Gas“, Heizperiode 2025:“)
  context?: ReactNode
  // Der eine Satz, was zu tun ist
  action?: ReactNode
  // Was sichtbar dazugehört, etwa eine Liste der betroffenen Positionen
  children?: ReactNode
  more?: ReactNode
  fix?: Fix | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const moreId = useId()
  const titleId = useId()
  return (
    <div className={`${noticeClass(level)} notice-item${className ? ` ${className}` : ''}`}>
      <div className="notice-head flex items-baseline gap-2">
        <span aria-hidden="true">{NOTICE_SYMBOLS[level]}</span>
        <span className="notice-level">{NOTICE_LEVEL_LABELS[level]}<span className="sr-only">:</span></span>
        {title && <strong id={titleId}>{title}</strong>}
      </div>
      {action && <div>{context && <span className="text-muted">{context}: </span>}{action}</div>}
      {children}
      {more && (
        <div className="print:block" id={moreId} hidden={!open}>{more}</div>
      )}
      {(fix || more) && (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {fix && (
            <button type="button" className="btn secondary notice-action" aria-describedby={title ? titleId : undefined} onClick={fix.onClick}>{fix.label}</button>
          )}
          {more && (
            <button type="button" className="btn ghost notice-action" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((o) => !o)}>
              Mehr dazu
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Ein fertiger Text einer Seite (etwa aus taxView.ts), zerlegt wie ein Hinweis der Berechnung.
export function TextNotice({ level, title, text, className }: { level: NoticeLevel, title?: ReactNode, text: string, className?: string }) {
  const { visible, more } = splitNoticeText(text, level)
  return <NoticeBox level={level} title={title} action={visible} more={more || null} className={className} />
}

// Ein Hinweis der Berechnung. Ohne Titel (abgeschlossen vor #112) trägt die Stufe allein den Kopf. Die
// Begriffe stehen offen darunter.
export function CalcNotice({ notice, fix, className }: { notice: Notice, fix?: Fix | null, className?: string }) {
  const { visible, more } = splitNoticeText(notice.text, notice.level)
  const terms = notice.terms ?? []
  return (
    <NoticeBox level={notice.level} title={notice.title || undefined} action={visible} more={more || null} fix={fix} className={className}>
      {terms.length > 0 && (
        <div className="notice-terms">Begriffe: {terms.map((t, k) => <Fragment key={t}>{k > 0 && ', '}<Term id={t} /></Fragment>)}</div>
      )}
    </NoticeBox>
  )
}

// Mehrere Hinweise einer Stufe zusammengefasst in einer aufklappbaren Zeile („3 Hinweise (…)“), darin die Hinweise.
export function NoticeGroup({ level, summary, children }: { level: NoticeLevel, summary: ReactNode, children: ReactNode }) {
  return (
    <details className={`${noticeClass(level)} notice-item`}>
      <summary><span aria-hidden="true">{NOTICE_SYMBOLS[level]}</span> {summary}</summary>
      <div className="notice-list">{children}</div>
    </details>
  )
}
