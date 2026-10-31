// Die Seite „Hilfe & Begriffe“ (#488): eine Startansicht mit großer Suche, den Anleitungen je Vermietungsart (#164) als
// Kacheln in drei Gruppen und den Themen des Lexikons (#113). Eine Anleitung öffnet sich als eigene Ansicht, ein Thema
// als Liste seiner Begriffe; „Zurück zu Hilfe & Begriffe“ führt zur Startansicht. Kein Router: Die Ansicht ist Zustand
// der Seite und beginnt bei jedem Seitenwechsel wieder auf der Startansicht. Entscheidungen (Suche, Rangfolge,
// Ausschnitt, Gruppen) stehen in helpView.ts.

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import PageHeader from '../components/PageHeader'
import Term from '../components/Term'
import { sortedTerms, termLetters } from '../glossaryView'
import { allGuides, type GuideEntry } from '../guideView'
import { firstSentence, GUIDE_GROUP_LABELS, guideGroups, POPULAR_SEARCHES, resultCountText, searchHelp, TERM_TOPIC_LABELS, termsOfTopic, topicCounts, type GuideHit, type Segment, type TermHit } from '../helpView'
import { pageLabel } from '../nav'
import { countOf, plural } from '../../../shared/wording.ts'
import type { GuideId, GuidePage } from '../../../shared/guides.ts'
import type { TermId, TermTopic } from '../../../shared/glossary.ts'

const ISSUE_URL = 'https://github.com/speedone/mietfuchs/issues/'

type View = { kind: 'home' } | { kind: 'guide'; id: GuideId } | { kind: 'terms'; topic: TermTopic | null }
type Hit = GuideHit | TermHit

// Wer eine Ansicht öffnet, kommt beim Zurück auf ihren Auslöser: eine Kachel (`data-help-key`) oder das Suchfeld.
const SEARCH = 'search'

// `focusTerm`: der Begriff, zu dem „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt (#346, Schritt 6). Die
// Seite zeigt dann alle Begriffe, klappt ihn auf und setzt den Fokus darauf. `seq` zählt jeden Sprung. Danach meldet sie
// `onFocusTermDone`, und die App vergisst den Sprung: Ein späterer gewöhnlicher Wechsel zur Hilfe beginnt oben
// (Durchsicht S1).
export default function Hilfe({ onNavigate, focusTerm, onFocusTermDone }: { onNavigate: (page: GuidePage) => void; focusTerm?: { id: TermId; seq: number } | null; onFocusTermDone?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [from, setFrom] = useState<string>(SEARCH)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
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
  const openGuide = (id: GuideId, origin: string) => {
    setFrom(origin)
    show({ kind: 'guide', id }, focusHeading)
  }
  const openTerms = (topic: TermTopic | null, origin: string) => {
    setFrom(origin)
    show({ kind: 'terms', topic }, focusHeading)
  }
  const openTerm = (id: TermId, origin: string) => {
    setFrom(origin)
    show({ kind: 'terms', topic: null }, () => focusEntry(id))
  }
  const back = () => show({ kind: 'home' }, () => {
    const target = from === SEARCH ? null : document.querySelector<HTMLElement>(`[data-help-key="${from}"]`)
    ;(target ?? searchRef.current)?.focus()
  })

  useEffect(() => {
    if (!focusTerm) return
    setFrom(SEARCH)
    show({ kind: 'terms', topic: null }, () => {
      focusEntry(focusTerm.id)
      onFocusTermDone?.()
    })
  }, [focusTerm])

  // Die Taste „/“ springt in die Suche, außer beim Schreiben in einem Feld und in einem Dialog (Erklärung am Handy,
  // Menüblatt).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, dialog'))) return
      e.preventDefault()
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
    if (q) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const search = (value: string) => {
    setQuery(value)
    setActive(0)
  }
  // Pfeiltasten wählen einen Treffer, Enter öffnet ihn (ohne Wahl den ersten), Esc leert die Suche.
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.length > 0) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((a) => (a + step + hits.length) % hits.length)
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

  // Ein Sprung beginnt oben auf der Zielseite, nicht auf der Höhe, auf der die Anleitung stand.
  const jump = (page: GuidePage) => {
    window.scrollTo(0, 0)
    onNavigate(page)
  }

  const backButton = <button type="button" className="btn ghost small mb-4" onClick={back}>← Zurück zu Hilfe & Begriffe</button>

  if (view.kind === 'guide') {
    const g = allGuides().find((x) => x.id === view.id)
    return (
      <>
        <PageHeader context="none" title="Hilfe & Begriffe" />
        {backButton}
        {g && (
          <>
            <h2 id="hilfe-ansicht" tabIndex={-1} className="mt-0 mb-4">{g.title}</h2>
            <div className="card guide" id={`anleitung-${g.id}`}>
              <GuideBody guide={g} onNavigate={jump} />
            </div>
          </>
        )}
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
          aria-controls={hits.length > 0 ? 'hilfe-anleitungen hilfe-begriffe' : undefined}
          aria-activedescendant={hits.length > 0 ? optionId(active) : undefined}
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="z. B. Garage, Mieterwechsel oder § 556"
          className="w-full text-l px-4 py-3 rounded-l shadow-2"
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
      {q !== '' && <ResultList title="Anleitungen" id="hilfe-anleitungen" hits={results.guides} offset={0} active={active} onOpen={openHit} />}
      {q !== '' && <ResultList title="Begriffe" id="hilfe-begriffe" hits={results.terms} offset={results.guides.length} active={active} onOpen={openHit} />}

      {q === '' && (
        <>
          <h2 className="help-section">Anleitungen <span className="text-s text-muted font-normal">{countOf(allGuides().length, 'Lage', 'Lagen')} der Vermietung, Schritt für Schritt</span></h2>
          {guideGroups().map(({ group, guides }) => (
            <Fragment key={group}>
              <h3 className="mt-4 mb-2 text-xs text-muted font-bold uppercase tracking-wide">{GUIDE_GROUP_LABELS[group]}</h3>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none m-0 p-0">
                {guides.map((g) => (
                  <li key={g.id} className="flex">
                    <button type="button" data-help-key={`guide:${g.id}`} onClick={() => openGuide(g.id, `guide:${g.id}`)} className="btn secondary flex w-full flex-col items-start justify-start gap-1 p-4 rounded-l text-left font-normal leading-snug">
                      <span className="font-strong text-base text-text">{g.title}</span>
                      <span className="text-s text-muted line-clamp-2">{firstSentence(g.applies)}</span>
                      <span className="text-xs text-muted mt-auto pt-1">{countOf(g.steps.length, 'Schritt', 'Schritte')}</span>
                    </button>
                  </li>
                ))}
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

// Eine Gruppe von Treffern als Liste (`role="listbox"`). Ihre Einträge wählt man mit den Pfeiltasten im Suchfeld
// (`aria-activedescendant`, über beide Listen hinweg gezählt) oder klickt sie an; sie sind selbst nicht fokussierbar,
// der Fokus bleibt im Suchfeld.
function ResultList({ title, id, hits, offset, active, onOpen }: { title: string; id: string; hits: readonly Hit[]; offset: number; active: number; onOpen: (hit: Hit) => void }) {
  if (hits.length === 0) return null
  return (
    <>
      <h2 className="help-section" id={`${id}-titel`}>{title} <span className="text-s text-muted font-normal">{hits.length}</span></h2>
      <div role="listbox" id={id} aria-labelledby={`${id}-titel`} className="bg-card border border-line rounded-l overflow-hidden">
        {hits.map((hit, k) => (
          <div
            key={`${hit.kind}-${hit.id}`}
            role="option"
            id={optionId(offset + k)}
            aria-selected={active === offset + k}
            onClick={() => onOpen(hit)}
            className="flex flex-col gap-1 px-4 py-3 border-b border-line last:border-b-0 border-l-4 border-l-transparent cursor-pointer hover:bg-hover aria-selected:bg-accent-soft aria-selected:border-l-accent"
          >
            {hit.kind === 'term' && <span className="text-xs text-muted font-bold uppercase tracking-wide">{TERM_TOPIC_LABELS[hit.topic]}</span>}
            <span className="font-strong"><Marked segments={hit.title} /></span>
            <span className="text-s text-muted wrap-anywhere"><Marked segments={hit.excerpt} /></span>
          </div>
        ))}
      </div>
    </>
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

// Eine Anleitung als eigene Ansicht. Inhaltsleiste und Faden-Leiste beim Sprung auf andere Seiten folgen (#488,
// zweiter Schritt).
function GuideBody({ guide: g, onNavigate }: { guide: GuideEntry; onNavigate: (page: GuidePage) => void }) {
  return (
    <>
      <h3 className="mt-0">Trifft das auf Sie zu?</h3>
      <p>{g.applies}</p>

      <h3>So legen Sie es an</h3>
      <ol className="guide-steps">
        {g.steps.map((s, i) => (
          <li key={i}>
            {s.text}
            {s.page && (
              <>
                {' '}
                <button type="button" className="btn small secondary guide-jump" onClick={() => s.page && onNavigate(s.page)}>
                  Zu {pageLabel(s.page)} →
                </button>
              </>
            )}
          </li>
        ))}
      </ol>

      <h3>Was Mietfuchs daraus macht</h3>
      <ul>
        {g.result.map((r, i) => <li key={i}>{r}</li>)}
      </ul>

      <h3>Beispiel</h3>
      <p>{g.example}</p>

      <h3>Worauf Sie achten müssen</h3>
      <ul>
        {g.caveats.map((c, i) => (
          <li key={i}>
            {c.text}
            {c.norm && <> <span className="muted">(<span className="guide-norm">{c.norm}</span>)</span></>}
          </li>
        ))}
      </ul>

      <h3>Was Mietfuchs (noch) nicht kann</h3>
      <ul>
        {g.gaps.map((x, i) => (
          <li key={i}>
            {x.text}
            {x.issue && <> <span className="muted">(geplant in <a href={`${ISSUE_URL}${x.issue}`} target="_blank" rel="noreferrer">#{x.issue}</a>)</span></>}
          </li>
        ))}
      </ul>

      <p className="guide-terms">
        <em>Begriffe:</em> {g.terms.map((t, k) => <Fragment key={t}>{k > 0 && ', '}<Term id={t} /></Fragment>)}
      </p>
    </>
  )
}
