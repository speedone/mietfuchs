// Die Seite „Hilfe & Begriffe“ (#488): eine Startansicht mit großer Suche, den Anleitungen je Vermietungsart (#164) als
// Kacheln in drei Gruppen und den Themen des Lexikons (#113). Eine Anleitung öffnet sich als eigene Ansicht mit Pfad und
// Inhaltsleiste (PR 2), ein Thema als Liste seiner Begriffe; „Zurück zu Hilfe & Begriffe“ bzw. der Pfad führt zur
// Startansicht. Kein Router: Die Ansicht ist Zustand der Seite und beginnt bei jedem Seitenwechsel wieder auf der
// Startansicht. Entscheidungen (Suche, Rangfolge, Ausschnitt, Gruppen, Abschnitte) stehen in helpView.ts. „Zu {Seite} →“
// meldet Anleitung und Schritt an die App (`onFollow`), die dort die Leiste des Fadens zeigt (components/GuideThread.tsx);
// „Zurück zur Anleitung“ kommt als `openGuide` zurück.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import PageHeader from '../components/PageHeader'
import { sortedTerms, termLetters } from '../glossaryView'
import { allGuides, type GuideEntry } from '../guideView'
import { firstSentence, GUIDE_GROUP_LABELS, GUIDE_SECTIONS, guideGroups, POPULAR_SEARCHES, relatedGuides, resultCountText, searchHelp, TERM_TOPIC_LABELS, termsOfTopic, topicCounts, type GuideHit, type GuideSection, type Segment, type TermHit } from '../helpView'
import { pageLabel } from '../nav'
import { countOf, plural } from '../../../shared/wording.ts'
import type { GuideId } from '../../../shared/guides.ts'
import { GLOSSARY, type TermId, type TermTopic } from '../../../shared/glossary.ts'

const ISSUE_URL = 'https://github.com/speedone/mietfuchs/issues/'

type View = { kind: 'home' } | { kind: 'guide'; id: GuideId } | { kind: 'terms'; topic: TermTopic | null }
type Hit = GuideHit | TermHit

// Wer eine Ansicht öffnet, kommt beim Zurück auf ihren Auslöser: eine Kachel (`data-help-key`) oder das Suchfeld.
const SEARCH = 'search'

// `focusTerm`: der Begriff, zu dem „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt (#346, Schritt 6). Die
// Seite zeigt dann alle Begriffe, klappt ihn auf und setzt den Fokus darauf. `seq` zählt jeden Sprung. Danach meldet sie
// `onFocusTermDone`, und die App vergisst den Sprung: Ein späterer gewöhnlicher Wechsel zur Hilfe beginnt oben
// (Durchsicht S1). `openGuide` ist dasselbe für „Zurück zur Anleitung“ aus der Leiste des Fadens: die Anleitung öffnen
// und den Fokus auf den Schritt setzen, von dem man kam.
export default function Hilfe({ onFollow, focusTerm, onFocusTermDone, openGuide: guideRequest, onOpenGuideDone }: {
  onFollow: (guide: GuideId, step: number) => void
  focusTerm?: { id: TermId; seq: number } | null
  onFocusTermDone?: () => void
  openGuide?: { id: GuideId; step: number; seq: number } | null
  onOpenGuideDone?: () => void
}) {
  const [view, setView] = useState<View>({ kind: 'home' })
  // Der Weg zurück: je geöffnete Ansicht die vorige und ihr Auslöser (`data-help-key`, das Suchfeld oder, bei einer
  // Anleitung, ihre Überschrift). So führt „Zurück“ nach einem Sprung aus einer Anleitung zu einem Begriff wieder in die
  // Anleitung und von dort zur Kachel (Durchsicht von #488, K4).
  const [trail, setTrail] = useState<{ view: View; key: string | null }[]>([])
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // Erst die Pfeiltasten führen den Vorleser in die Liste (`aria-activedescendant`); beim Tippen bleibt er im Feld, die
  // optische Markierung des Treffers für Enter bleibt (Durchsicht von #488, S2).
  const [inList, setInList] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // Was nach dem Zeichnen der neuen Ansicht geschieht (den Fokus setzen); `tick` sorgt dafür, dass gezeichnet wird.
  const pending = useRef<(() => void) | null>(null)
  const [tick, setTick] = useState(0)
  const show = (next: View, then: () => void) => {
    pending.current = then
    setView(next)
    setTick((t) => t + 1)
  }
  useEffect(() => {
    const run = pending.current
    pending.current = null
    run?.()
  }, [tick])

  const focusHeading = () => document.getElementById('hilfe-ansicht')?.focus()
  const open = (next: View, key: string | null, then: () => void) => {
    setTrail((t) => [...t, { view, key }])
    show(next, then)
  }
  const openGuide = (id: GuideId, origin: string) => open({ kind: 'guide', id }, origin, focusHeading)
  const openTerms = (topic: TermTopic | null, origin: string) => open({ kind: 'terms', topic }, origin, focusHeading)
  const openTerm = (id: TermId, origin: string) => open({ kind: 'terms', topic: null }, origin, () => focusEntry(id))
  const back = () => {
    const last = trail.at(-1) ?? { view: { kind: 'home' } as View, key: SEARCH }
    setTrail((t) => t.slice(0, -1))
    show(last.view, () => {
      const target = last.key === SEARCH || last.key === null ? null : document.querySelector<HTMLElement>(`[data-help-key="${last.key}"]`)
      if (target) return target.focus()
      if (last.view.kind !== 'home') return focusHeading()
      searchRef.current?.focus()
    })
  }
  // Der Pfad „Hilfe & Begriffe“: zur Startansicht, Fokus auf die Kachel `key` (sonst die Suche).
  const home = (key: string) => {
    setTrail([])
    show({ kind: 'home' }, () => (document.querySelector<HTMLElement>(`[data-help-key="${key}"]`) ?? searchRef.current)?.focus())
  }

  useEffect(() => {
    if (!guideRequest) return
    setTrail([])
    show({ kind: 'guide', id: guideRequest.id }, () => {
      focusStep(guideRequest.step)
      onOpenGuideDone?.()
    })
  }, [guideRequest])

  useEffect(() => {
    if (!focusTerm) return
    const then = () => {
      focusEntry(focusTerm.id)
      onFocusTermDone?.()
    }
    if (view.kind === 'terms') show({ kind: 'terms', topic: null }, then)
    else open({ kind: 'terms', topic: null }, view.kind === 'home' ? SEARCH : null, then)
  }, [focusTerm])

  // Die Taste „/“ springt in die Suche, außer beim Schreiben in einem Feld und in einem Dialog: dem Menüblatt, einer
  // Rückfrage und der Erklärung eines Begriffs (ein Popover mit der Rolle eines Dialogs, am Handy ein Blatt; Durchsicht
  // von #488, S3). `[role$=…]` trifft dialog und alertdialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, dialog, [role$="dialog"]'))) return
      e.preventDefault()
      setTrail([])
      show({ kind: 'home' }, () => searchRef.current?.focus())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const results = useMemo(() => searchHelp(query), [query])
  const hits: Hit[] = [...results.guides, ...results.terms]
  const q = query.trim()
  const openHit = (hit: Hit) => (hit.kind === 'guide' ? openGuide(hit.id, SEARCH) : openTerm(hit.id, SEARCH))
  useEffect(() => {
    if (inList) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [active, inList])

  const search = (value: string) => {
    setQuery(value)
    setActive(0)
    setInList(false)
  }
  // Pfeiltasten wählen einen Treffer, Enter öffnet ihn (ohne Wahl den ersten), Esc leert die Suche.
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length > 0) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      // Der erste Druck auf ↓ geht vom markierten ersten Treffer zum zweiten, wie die Markierung es zeigt.
      setActive((a) => (a + step + hits.length) % hits.length)
      setInList(true)
    } else if (e.key === 'Enter') {
      const hit = hits[active]
      if (hit) {
        e.preventDefault()
        openHit(hit)
      }
    } else if (e.key === 'Escape' && query !== '') {
      e.preventDefault()
      search('')
    }
  }

  // Wohin „Zurück“ führt, sagt der Knopf (Durchsicht von PR 2, S3 und K7): in die Anleitung, aus der man kam, sonst
  // zur Startansicht.
  const previous = trail.at(-1)?.view
  const previousGuide = previous?.kind === 'guide' ? allGuides().find((x) => x.id === previous.id) : undefined
  const backButton = <button type="button" className="btn ghost small mb-4" onClick={back}>{previousGuide ? '← Zurück zur Anleitung' : '← Zurück zu Hilfe & Begriffe'}</button>

  if (view.kind === 'guide') {
    const g = allGuides().find((x) => x.id === view.id)
    if (!g) return null
    return (
      <>
        {/* Statt des Seitenkopfs der Pfad und der Titel der Anleitung; „Hilfe & Begriffe“ führt zur Startansicht. */}
        {/* Kam man über „Ähnliche Anleitungen“, führt der Weg zurück in die vorige Anleitung (S3). */}
        {previousGuide && <button type="button" className="btn ghost small mb-2 no-print" onClick={back}>← Zurück zu {previousGuide.title}</button>}
        <nav aria-label="Pfad" className="no-print flex flex-wrap items-center gap-2 mb-2 text-s text-muted">
          <button type="button" className="btn ghost small" onClick={() => home(`guide:${g.id}`)}>Hilfe & Begriffe</button>
          <span aria-hidden="true">›</span>
          <span>Anleitungen</span>
        </nav>
        <h1 id="hilfe-ansicht" tabIndex={-1} className="mb-6">{g.title}</h1>
        <GuideView guide={g} onFollow={(step) => onFollow(g.id, step)} onOpenTerm={(id) => openTerm(id, `term:${id}`)} onOpenGuide={(id) => openGuide(id, `guide:${id}`)} />
      </>
    )
  }

  if (view.kind === 'terms') {
    return (
      <>
        <PageHeader context="none" title="Hilfe & Begriffe" />
        {backButton}
        <TermList topic={view.topic} />
      </>
    )
  }

  const counts = topicCounts()
  const total = counts.reduce((a, c) => a + c.count, 0)
  const topicTiles = [
    ...counts.map((c) => ({ key: `topic:${c.topic}`, topic: c.topic as TermTopic | null, label: TERM_TOPIC_LABELS[c.topic], count: c.count })),
    { key: 'topic:alle', topic: null, label: 'Alle von A bis Z', count: total },
  ]
  return (
    <>
      <PageHeader
        context="none"
        title="Hilfe & Begriffe"
        subtitle="Anleitungen für Ihre Lage und die Fachbegriffe der Nebenkostenabrechnung in einfachen Worten. Dieselben Erklärungen erscheinen in den Formularen, wenn Sie einen gestrichelt unterstrichenen Begriff oder das „?“ dahinter antippen."
      />
      <label className="field width-full">
        <span className="flex items-baseline justify-between gap-3">
          Suchen in Anleitungen und Begriffen
          <span className="text-xs text-muted font-normal max-sm:hidden" aria-hidden="true">Taste <kbd className="border border-line rounded-s px-1 bg-bg">/</kbd></span>
        </span>
        <input
          ref={searchRef}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={hits.length > 0}
          aria-controls={hits.length > 0 ? 'hilfe-treffer' : undefined}
          aria-activedescendant={inList && hits.length > 0 ? optionId(active) : undefined}
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="z. B. Garage oder § 556"
          className="w-full text-l px-4 py-3 rounded-l"
        />
      </label>
      {/* Die Trefferzahl für Vorleser; die Liste selbst sagen sie erst, wenn man mit den Pfeiltasten hineingeht. */}
      <p role="status" className="sr-only">{q ? resultCountText(results.guides.length, results.terms.length) : ''}</p>

      {q === '' && (
        <div className="flex flex-wrap items-center gap-2 mt-3 text-s text-muted">
          <span>Häufig gesucht:</span>
          {POPULAR_SEARCHES.map((w) => (
            <button key={w} type="button" className="btn ghost small" onClick={() => { search(w); searchRef.current?.focus() }}>{w}</button>
          ))}
        </div>
      )}

      {q !== '' && hits.length === 0 && (
        <p className="mt-6">
          Nichts gefunden zu „{q}“. Versuchen Sie ein anderes Wort, oder sehen Sie unter{' '}
          <button type="button" className="btn ghost small" onClick={() => openTerms(null, SEARCH)}>Alle Begriffe von A bis Z</button> nach.
        </p>
      )}
      {q !== '' && hits.length > 0 && (
        // Eine Liste mit zwei Gruppen (Durchsicht von #488, S5): Eine Combobox steuert genau eine Liste.
        <div role="listbox" id="hilfe-treffer" aria-label="Treffer">
          <ResultGroup title="Anleitungen" id="hilfe-anleitungen" hits={results.guides} offset={0} active={active} onOpen={openHit} />
          <ResultGroup title="Begriffe" id="hilfe-begriffe" hits={results.terms} offset={results.guides.length} active={active} onOpen={openHit} />
        </div>
      )}

      {q === '' && (
        <>
          <h2 className="help-section">Anleitungen <span className="text-s text-muted font-normal">{countOf(allGuides().length, 'Lage', 'Lagen')} der Vermietung, Schritt für Schritt</span></h2>
          {guideGroups().map(({ group, guides }) => (
            <Fragment key={group}>
              <h3 className="mt-4 mb-2 text-xs text-muted font-bold uppercase tracking-wide">{GUIDE_GROUP_LABELS[group]}</h3>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none m-0 p-0">
                {guides.map((g) => <GuideTile key={g.id} guide={g} onOpen={() => openGuide(g.id, `guide:${g.id}`)} />)}
              </ul>
            </Fragment>
          ))}

          <h2 className="help-section">Lexikon <span className="text-s text-muted font-normal">{countOf(total, 'Fachbegriff', 'Fachbegriffe')} in einfachen Worten</span></h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none m-0 p-0">
            {topicTiles.map((t) => (
              <li key={t.key} className="flex">
                <button type="button" data-help-key={t.key} onClick={() => openTerms(t.topic, t.key)} className="btn secondary flex w-full justify-between gap-3 px-4 py-3 rounded-l text-left">
                  <span className="font-strong">{t.label}</span>{' '}
                  <span className="text-xs text-muted bg-chip rounded-s px-2 tabular-nums">{t.count} <span className="sr-only">{plural(t.count, 'Begriff', 'Begriffe')}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

const optionId = (i: number) => `hilfe-treffer-${i}`

// Fundstellen als <mark>, der Rest als Text.
function Marked({ segments }: { segments: readonly Segment[] }) {
  return <>{segments.map((s, i) => (s.hit ? <mark key={i} className="bg-mark text-text rounded-s">{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}</>
}

// Eine Gruppe von Treffern in der Liste (`role="group"`, benannt nach ihrer Überschrift). Ihre Einträge wählt man mit den
// Pfeiltasten im Suchfeld (`aria-activedescendant`, über beide Gruppen hinweg gezählt) oder klickt sie an; sie sind
// selbst nicht fokussierbar, der Fokus bleibt im Suchfeld. Der Name eines Eintrags ist sein ganzer sichtbarer Text
// (Thema, Titel, Ausschnitt): Nur den Titel als Namen und den Ausschnitt als Beschreibung (K1 der Durchsicht) wertet axe
// als `label-content-name-mismatch` (WCAG 2.5.3, serious), auch mit Thema und Titel als Name.
function ResultGroup({ title, id, hits, offset, active, onOpen }: { title: string; id: string; hits: readonly Hit[]; offset: number; active: number; onOpen: (hit: Hit) => void }) {
  if (hits.length === 0) return null
  return (
    <div role="group" id={id} aria-labelledby={`${id}-titel`}>
      <div className="help-section font-bold" id={`${id}-titel`}>{title} <span className="text-s text-muted font-normal">{hits.length}</span></div>
      <div className="bg-card border border-line rounded-l overflow-hidden">
        {hits.map((hit, k) => {
          const oid = optionId(offset + k)
          return (
            <div
              key={`${hit.kind}-${hit.id}`}
              role="option"
              id={oid}
              aria-selected={active === offset + k}
              onClick={() => onOpen(hit)}
              className="flex flex-col gap-1 px-4 py-3 border-b border-line last:border-b-0 border-l-4 border-l-transparent cursor-pointer hover:bg-hover aria-selected:bg-accent-soft aria-selected:border-l-accent"
            >
              {hit.kind === 'term' && <span className="text-xs text-muted font-bold uppercase tracking-wide">{TERM_TOPIC_LABELS[hit.topic]}</span>}{' '}
              <span className="font-strong"><Marked segments={hit.title} /></span>{' '}
              <span className="text-s text-muted wrap-anywhere"><Marked segments={hit.excerpt} /></span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Den Begriff aufklappen, in den Blick rollen und den Fokus auf die Zeile zum Auf- und Zuklappen setzen: Auf dem
// Kasten selbst klappte Enter nichts auf (Durchsicht von N10).
function focusEntry(id: TermId) {
  const entry = document.getElementById(`begriff-${id}`)
  if (entry instanceof HTMLDetailsElement) entry.open = true
  entry?.scrollIntoView?.({ block: 'start' })
  entry?.querySelector('summary')?.focus({ preventScroll: true })
}

// Die Begriffe eines Themas oder alle, zugeklappt mit Buchstabenleiste (N10 aus #341). Bis zur zweispaltigen Ansicht
// des Lexikons (#488, dritter Schritt) die bisherige Liste.
function TermList({ topic }: { topic: TermTopic | null }) {
  const terms = useMemo(() => termsOfTopic(sortedTerms(), topic), [topic])
  const letters = termLetters(terms)
  const jumpToLetter = (id: TermId) => {
    const entry = document.getElementById(`begriff-${id}`)
    entry?.scrollIntoView?.({ block: 'start' })
    entry?.querySelector('summary')?.focus({ preventScroll: true })
  }
  return (
    <>
      <h2 id="hilfe-ansicht" tabIndex={-1} className="mt-0 mb-4">
        {topic ? TERM_TOPIC_LABELS[topic] : 'Alle Begriffe von A bis Z'} <span className="text-s text-muted font-normal">{countOf(terms.length, 'Begriff', 'Begriffe')}</span>
      </h2>
      {letters.length > 1 && (
        <nav aria-label="Begriffe nach Anfangsbuchstabe" className="flex flex-wrap gap-2 mb-3">
          {letters.map((l) => (
            <button key={l.letter} type="button" className="btn ghost small" aria-label={`Begriffe mit ${l.letter}`} onClick={() => jumpToLetter(l.id)}>{l.letter}</button>
          ))}
        </nav>
      )}
      {terms.map((t) => (
        <details key={t.id} className="card guide glossary-entry" id={`begriff-${t.id}`}>
          <summary><h3 className="guide-title">{t.title}</h3></summary>
          <p>{t.short}</p>
          <p><em>Beispiel:</em> {t.example}</p>
          {t.norm && <p><em>Rechtsgrundlage:</em> {t.norm}</p>}
          <p><em>Brauche ich das?</em> {t.needed}</p>
        </details>
      ))}
    </>
  )
}

// Eine Anleitung als Kachel: Titel, erster Satz, Zahl der Schritte (Startansicht und „Ähnliche Anleitungen“).
function GuideTile({ guide: g, onOpen }: { guide: GuideEntry; onOpen: () => void }) {
  return (
    <li className="flex">
      <button type="button" data-help-key={`guide:${g.id}`} onClick={onOpen} className="btn secondary flex w-full flex-col items-start justify-start gap-1 p-4 rounded-l text-left font-normal leading-snug">
        <span className="font-strong text-base text-text">{g.title}</span>
        <span className="text-s text-muted line-clamp-2">{firstSentence(g.applies)}</span>
        <span className="text-xs text-muted mt-auto pt-1">{countOf(g.steps.length, 'Schritt', 'Schritte')}</span>
      </button>
    </li>
  )
}

const sectionId = (s: GuideSection | 'zutreffen' | 'aehnlich') => `abschnitt-${s}`

// Den Schritt `step` (ab 0) in den Blick rollen und den Fokus darauf setzen: „Zurück zur Anleitung“ aus dem Faden.
function focusStep(step: number) {
  const el = document.getElementById(`schritt-${step + 1}`)
  el?.scrollIntoView?.({ block: 'center' })
  el?.focus({ preventScroll: true })
}

// Zum Abschnitt springen (Inhaltsleiste): rollen und den Fokus auf seine Überschrift, damit Tab dort weitergeht.
function goToSection(id: GuideSection) {
  const el = document.getElementById(sectionId(id))
  el?.scrollIntoView?.({ block: 'start' })
  el?.focus({ preventScroll: true })
}

// Eine Überschrift eines Abschnitts, Sprungziel der Inhaltsleiste.
function SectionHeading({ id, children }: { id: GuideSection | 'aehnlich'; children: string }) {
  return <h2 id={sectionId(id)} tabIndex={-1} className="mt-0 mb-3 text-l">{children}</h2>
}

// Eine Anleitung als eigene Ansicht (#488, PR 2), Aufbau nach dem freigegebenen Vorschlag: „Trifft das auf Sie zu?“ als
// hervorgehobener Kasten, die Schritte als nummerierte Karten mit dem Sprung auf ihre Seite, das Beispiel grün und die
// Hinweise gelb getönt (Rechtsgrundlage als Marke), Begriffe als Knöpfe, darunter ähnliche Anleitungen derselben
// Gruppe. Ab genügender Breite steht links eine Inhaltsleiste, die beim Rollen stehen bleibt (`guide-layout`,
// `guide-toc` in tw.css); am Handy fehlt sie.
function GuideView({ guide: g, onFollow, onOpenTerm, onOpenGuide }: { guide: GuideEntry; onFollow: (step: number) => void; onOpenTerm: (id: TermId) => void; onOpenGuide: (id: GuideId) => void }) {
  const related = relatedGuides(g.id)
  return (
    <div className="@container">
      <div className="guide-layout">
        <nav aria-label="Inhalt" className="guide-toc no-print">
          {GUIDE_SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => goToSection(s.id)}>{s.label}</button>
          ))}
        </nav>
        <div id={`anleitung-${g.id}`} className="flex flex-col gap-8 min-w-0 wrap-anywhere">
          <section aria-labelledby={sectionId('zutreffen')} className="bg-accent-soft rounded-l px-4 py-3">
            <h2 id={sectionId('zutreffen')} className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-accent-strong">Trifft das auf Sie zu?</h2>
            <p className="m-0">{g.applies}</p>
          </section>

          <section aria-labelledby={sectionId('schritte')}>
            <SectionHeading id="schritte">So legen Sie es an</SectionHeading>
            {/* role="list": Safari nimmt einer Liste ohne Aufzählungszeichen sonst die Rolle. */}
            <ol role="list" aria-labelledby={sectionId('schritte')} className="list-none m-0 p-0 flex flex-col gap-3">
              {g.steps.map((s, i) => (
                <li key={i} id={`schritt-${i + 1}`} tabIndex={-1} className="flex gap-3 bg-card border border-line rounded-l p-4 shadow-1 focus:border-accent">
                  <span className="flex-none flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-text text-s font-bold tabular-nums">{i + 1}</span>
                  <div className="min-w-0 flex flex-col items-start gap-2">
                    <p className="m-0">{s.text}</p>
                    {s.page && <button type="button" className="btn small secondary" onClick={() => onFollow(i)}>Zu {pageLabel(s.page)} →</button>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby={sectionId('ergebnis')}>
            <SectionHeading id="ergebnis">Was Mietfuchs daraus macht</SectionHeading>
            <ul className="m-0 pl-6 flex flex-col gap-2">
              {g.result.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </section>

          <section aria-labelledby={sectionId('beispiel')} className="bg-green-soft rounded-l px-4 py-3">
            <h2 id={sectionId('beispiel')} tabIndex={-1} className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-green">Beispiel</h2>
            <p className="m-0">{g.example}</p>
          </section>

          <section aria-labelledby={sectionId('achtung')}>
            <SectionHeading id="achtung">Worauf Sie achten müssen</SectionHeading>
            <ul role="list" className="list-none m-0 p-0 flex flex-col gap-2">
              {g.caveats.map((c, i) => (
                <li key={i} className="flex flex-col items-start gap-2 bg-amber-soft border border-notice-border rounded-l px-4 py-3">
                  <span>{c.text}</span>
                  {c.norm && <span><span className="sr-only">Rechtsgrundlage: </span><span className="guide-norm inline-block text-xs text-muted bg-chip rounded-s px-2 py-0.5">{c.norm}</span></span>}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={sectionId('luecken')}>
            <SectionHeading id="luecken">Was Mietfuchs (noch) nicht kann</SectionHeading>
            <ul className="m-0 pl-6 flex flex-col gap-2">
              {g.gaps.map((x, i) => (
                <li key={i}>
                  {x.text}
                  {x.issue && <> <span className="muted">(geplant in <a href={`${ISSUE_URL}${x.issue}`} target="_blank" rel="noreferrer">#{x.issue}</a>)</span></>}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={sectionId('begriffe')}>
            <SectionHeading id="begriffe">Begriffe</SectionHeading>
            <ul role="list" className="list-none m-0 p-0 flex flex-wrap gap-2">
              {g.terms.map((t) => (
                <li key={t}><button type="button" data-help-key={`term:${t}`} className="btn secondary small" onClick={() => onOpenTerm(t)}>{GLOSSARY[t].title}</button></li>
              ))}
            </ul>
          </section>

          {related.length > 0 && (
            <section aria-labelledby={sectionId('aehnlich')} className="no-print">
              <SectionHeading id="aehnlich">Ähnliche Anleitungen</SectionHeading>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none m-0 p-0">
                {related.map((r) => <GuideTile key={r.id} guide={r} onOpen={() => onOpenGuide(r.id)} />)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
