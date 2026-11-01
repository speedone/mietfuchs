// Die Seite „Hilfe & Begriffe“ (#488): eine Startansicht mit großer Suche, den Anleitungen je Vermietungsart (#164) als
// Kacheln in drei Gruppen und den Themen des Lexikons (#113). Eine Anleitung öffnet sich als eigene Ansicht mit Pfad und
// Inhaltsleiste (PR 2), ein Thema oder ein Begriff im Lexikon (Teil 3: Liste mit Themenfilter, daneben der Begriff);
// der Pfad führt zur Startansicht. Kein Router: Die Ansicht ist Zustand der Seite und beginnt bei jedem Seitenwechsel
// wieder auf der Startansicht. Entscheidungen (Suche, Rangfolge, Ausschnitt, Gruppen, Abschnitte, Lexikon) stehen in
// helpView.ts. „Zu {Seite} →“ meldet Anleitung und Schritt an die App (`onFollow`), die dort die Leiste des Fadens zeigt
// (components/GuideThread.tsx); „Zurück zur Anleitung“ kommt als `openGuide` zurück. Über den Anleitungen schlägt
// „Passend zu Ihrem Bestand“ bis zu drei vor, jede mit ihrem Grund (Teil 4, Regeln in helpSuggestions.ts); die App
// reicht dafür den Bestand des gewählten Objekts herein (`stock`).

import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import PageHeader from '../components/PageHeader'
import { allGuides, type GuideEntry } from '../guideView'
import { chooseTerm, chooseTopic, firstSentence, GUIDE_GROUP_LABELS, GUIDE_SECTIONS, guideGroups, guidesWithTerm, jumpToTerm, lexiconEntries, lexiconFilters, lexiconPane, POPULAR_SEARCHES, relatedGuides, relatedTerms, resultCountText, searchHelp, TERM_TOPIC_LABELS, topicCounts, type GuideHit, type GuideSection, type LexiconState, type Segment, type TermHit } from '../helpView'
import { pageLabel } from '../nav'
import { suggestGuides, type HelpStock } from '../helpSuggestions'
import { countOf, plural } from '../../../shared/wording.ts'
import type { GuideId } from '../../../shared/guides.ts'
import { GLOSSARY, type Term, type TermId, type TermTopic } from '../../../shared/glossary.ts'

const ISSUE_URL = 'https://github.com/speedone/mietfuchs/issues/'

type View = { kind: 'home' } | { kind: 'guide'; id: GuideId } | ({ kind: 'lexicon' } & LexiconState)
type Hit = GuideHit | TermHit

// Wer eine Ansicht öffnet, kommt beim Zurück auf ihren Auslöser: eine Kachel (`data-help-key`) oder das Suchfeld.
const SEARCH = 'search'

// `focusTerm`: der Begriff, zu dem „Mehr in ‚Hilfe & Begriffe‘ →“ aus einer Erklärung führt (#346, Schritt 6). Die
// Seite öffnet dann das Lexikon unter „Alle“ auf ihm (`jumpToTerm`) und setzt den Fokus auf seine Überschrift. `seq`
// zählt jeden Sprung. Danach meldet sie `onFocusTermDone`, und die App vergisst den Sprung: Ein späterer gewöhnlicher
// Wechsel zur Hilfe beginnt oben (Durchsicht S1). `openGuide` ist dasselbe für „Zurück zur Anleitung“ aus der Leiste
// des Fadens: die Anleitung öffnen und den Fokus auf den Schritt setzen, von dem man kam.
export default function Hilfe({ onFollow, focusTerm, onFocusTermDone, openGuide: guideRequest, onOpenGuideDone, stock = null }: {
  onFollow: (guide: GuideId, step: number) => void
  stock?: HelpStock | null
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
  const openLexicon = (topic: TermTopic | null, origin: string) => open({ kind: 'lexicon', topic, term: null }, origin, focusHeading)
  const openTerm = (id: TermId, origin: string) => open({ kind: 'lexicon', ...jumpToTerm(id) }, origin, () => focusTermHeading(id))
  // Innerhalb des Lexikons wechseln Thema und Begriff ohne neuen Schritt auf dem Weg zurück. `announce` sagt breit den
  // Begriff an, der rechts erscheint, während der Fokus in der Liste bleibt (Durchsicht von Teil 3, M2).
  const [announce, setAnnounce] = useState('')
  const lexicon = (next: LexiconState, then: () => void) => {
    setAnnounce('')
    show({ kind: 'lexicon', ...next }, then)
  }
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
  const home = (key: string | null) => {
    setTrail([])
    show({ kind: 'home' }, () => (document.querySelector<HTMLElement>(`[data-help-key="${key}"]`) ?? searchRef.current)?.focus())
  }
  // Aus dem Lexikon: auf den Auslöser in der Startansicht (Kachel oder Suche), mit dem man den Weg begann.
  const start = trail[0]
  const homeFromStart = () => home(start?.view.kind === 'home' ? start.key : null)

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
      focusTermHeading(focusTerm.id)
      onFocusTermDone?.()
    }
    if (view.kind === 'lexicon') lexicon(jumpToTerm(focusTerm.id), then)
    else open({ kind: 'lexicon', ...jumpToTerm(focusTerm.id) }, view.kind === 'home' ? SEARCH : null, then)
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
  const suggestions = useMemo(() => suggestGuides(stock), [stock])
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

  // Wohin „Zurück“ führt, sagt der Knopf (Durchsicht von PR 2, S3 und K7): in die Anleitung oder zu dem Begriff, aus
  // dem man kam. Zur Startansicht führt der Pfad.
  const previous = trail.at(-1)?.view
  const previousGuide = previous?.kind === 'guide' ? allGuides().find((x) => x.id === previous.id) : undefined
  const previousTerm = previous?.kind === 'lexicon' && previous.term ? GLOSSARY[previous.term] : undefined

  if (view.kind === 'guide') {
    const g = allGuides().find((x) => x.id === view.id)
    if (!g) return null
    return (
      <>
        {/* Statt des Seitenkopfs der Pfad und der Titel der Anleitung; „Hilfe & Begriffe“ führt zur Startansicht. */}
        {/* Kam man über „Ähnliche Anleitungen“, führt der Weg zurück in die vorige Anleitung (S3). */}
        {previousGuide && <button type="button" className="btn ghost small mb-2 no-print" onClick={back}>← Zurück zu {previousGuide.title}</button>}
        {/* Kam man über „Kommt vor in“, führt der Weg zurück zum Begriff (#488, Teil 3). */}
        {previousTerm && <button type="button" className="btn ghost small mb-2 no-print" onClick={back}>← Zurück zu {previousTerm.title}</button>}
        <nav aria-label="Pfad" className="no-print flex flex-wrap items-center gap-2 mb-2 text-s text-muted">
          {/* Auf die Kachel, mit der der Weg begann, wenn es der Vorschlag dieser Anleitung war; sonst auf ihre Kachel. */}
          <button type="button" className="btn ghost small" onClick={() => home(start?.view.kind === 'home' && start.key === `suggest:${g.id}` ? start.key : `guide:${g.id}`)}>Hilfe & Begriffe</button>
          <span aria-hidden="true">›</span>
          <span>Anleitungen</span>
        </nav>
        <h1 id="hilfe-ansicht" tabIndex={-1} className="mb-6">{g.title}</h1>
        <GuideView guide={g} onFollow={(step) => onFollow(g.id, step)} onOpenTerm={(id) => openTerm(id, `term:${id}`)} onOpenGuide={(id) => openGuide(id, `guide:${id}`)} />
      </>
    )
  }

  if (view.kind === 'lexicon') {
    const state: LexiconState = { topic: view.topic, term: view.term }
    return (
      <>
        {/* Wer aus einer Anleitung kam, kommt in sie zurück; zur Startansicht führt der Pfad. Das Ziel steht im Text,
            kein Aufklapper (S33). */}
        {previousGuide && <button type="button" className="btn ghost small mb-2 no-print" onClick={back}>← Zurück zur Anleitung</button>}
        <nav aria-label="Pfad" className="no-print flex flex-wrap items-center gap-2 mb-2 text-s text-muted">
          <button type="button" className="btn ghost small" onClick={homeFromStart}>Hilfe & Begriffe</button>
          <span aria-hidden="true">›</span>
          <span>Lexikon</span>
        </nav>
        <h1 id="hilfe-ansicht" tabIndex={-1} className="mb-4">Lexikon</h1>
        <LexiconView
          state={state}
          onTopic={(topic) => lexicon(chooseTopic(topic), () => {})}
          announce={announce}
          onPick={(id) => lexicon(chooseTerm(state, id), () => {
            // Breit bleibt die Liste stehen und der Fokus auf dem Eintrag (sonst führte Shift+Tab aus dem Begriff auf den
            // letzten der Liste statt auf den gewählten); die Statusmeldung sagt den Begriff an. Schmal verschwindet die
            // Liste, der Fokus geht auf die Überschrift des Begriffs.
            const entry = listEntry(id)
            if (entry && isShown(entry)) setAnnounce(`Rechts angezeigt: ${GLOSSARY[id].title}`)
            else focusTermHeading(id)
          })}
          onTerm={(id) => lexicon(chooseTerm(state, id), () => focusTermHeading(id))}
          onList={() => {
            const was = state.term
            lexicon({ ...state, term: null }, () => { if (was) focusListEntry(was) })
          }}
          onOpenGuide={(id) => openGuide(id, `guide:${id}`)}
        />
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
          <button type="button" className="btn ghost small" onClick={() => openLexicon(null, SEARCH)}>Alle Begriffe von A bis Z</button> nach.
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
          {/* Ohne Treffer entfällt der Abschnitt ganz, kein leerer Kasten. Eigener Schlüssel der Kachel (`suggest:`), damit
              der Weg zurück auf diese Kachel führt und nicht auf dieselbe Anleitung in ihrer Gruppe. */}
          {suggestions.length > 0 && (
            <>
              <h2 className="help-section">Passend zu Ihrem Bestand</h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 list-none m-0 p-0">
                {suggestions.map((s) => {
                  const g = allGuides().find((x) => x.id === s.guideId)
                  return g && <GuideTile key={g.id} guide={g} reason={s.reason} helpKey={`suggest:${g.id}`} onOpen={() => openGuide(g.id, `suggest:${g.id}`)} />
                })}
              </ul>
            </>
          )}

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
                <button type="button" data-help-key={t.key} onClick={() => openLexicon(t.topic, t.key)} className="btn secondary flex w-full justify-between gap-3 px-4 py-3 rounded-l text-left">
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

// Den Begriff in den Blick holen und den Fokus auf seine Überschrift setzen; in der Liste rollt sein Eintrag mit (breit
// rollt die Liste für sich). Steht der Begriff schon oben im Fenster, rollt die Seite nicht.
function focusTermHeading(id: TermId) {
  const heading = document.getElementById(`begriff-${id}`)
  if (!heading) return
  scrollListTo(id)
  const article = heading.closest('article') ?? heading
  const top = article.getBoundingClientRect().top
  if (top < 0 || top > window.innerHeight / 2) article.scrollIntoView?.({ block: 'start' })
  heading.focus({ preventScroll: true })
}

const listEntry = (id: TermId) => document.querySelector<HTMLElement>(`[data-lexicon-term="${id}"]`)

// Ob ein Element zu sehen ist. Breit oder schmal entscheidet tw.css über eine Container-Abfrage; die Seite fragt deshalb
// das Element (ohne `checkVisibility`, etwa in älterem Safari, über seine Rechtecke).
function isShown(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0
}

// Zurück in die Liste (am Handy „← Zur Liste“): Fokus auf den Eintrag des Begriffs, von dem man kam.
function focusListEntry(id: TermId) {
  const entry = listEntry(id)
  entry?.scrollIntoView?.({ block: 'center' })
  entry?.focus({ preventScroll: true })
}

// Den Eintrag in der für sich rollenden Liste (breit) sichtbar machen, ohne die Seite zu rollen.
function scrollListTo(id: TermId) {
  const entry = listEntry(id)
  const list = entry?.closest<HTMLElement>('.lexicon-list')
  if (!entry || !list || list.scrollHeight <= list.clientHeight) return
  const e = entry.getBoundingClientRect()
  const l = list.getBoundingClientRect()
  if (e.top < l.top || e.bottom > l.bottom) list.scrollTop += e.top - l.top - l.height / 3
}

// Das Lexikon (#488, Teil 3), Aufbau nach dem freigegebenen Vorschlag: oben der Themenfilter (Umschaltknöpfe mit Zahl),
// darunter links die Liste mit Anfangsbuchstaben als Trennern, rechts der gewählte Begriff. Schmal steht nur eins von
// beiden (`data-pane`, tw.css). Entscheidungen (Filter, Reihenfolge, „Kommt vor in“, verwandte Begriffe) in helpView.ts.
function LexiconView({ state, announce, onTopic, onPick, onTerm, onList, onOpenGuide }: {
  state: LexiconState
  announce: string
  onTopic: (topic: TermTopic | null) => void
  onPick: (id: TermId) => void
  onTerm: (id: TermId) => void
  onList: () => void
  onOpenGuide: (id: GuideId) => void
}) {
  const entries = useMemo(() => lexiconEntries(state.topic), [state.topic])
  // Die Liste ist ein Halt der Tabulatortaste (der zuletzt fokussierte Eintrag, sonst der gewählte, sonst der erste);
  // die Pfeiltasten, Pos1 und Ende bewegen in ihr. So führt Tab vom Eintrag in den Begriff und Shift+Tab zurück auf ihn.
  const [roving, setRoving] = useState<TermId | null>(null)
  const stop = entries.some((e) => e.id === roving) ? roving : entries.some((e) => e.id === state.term) ? state.term : entries[0]?.id
  const onListKey = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-lexicon-term]')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null
    if (to === null || at < 0) return
    e.preventDefault()
    buttons[Math.max(0, Math.min(buttons.length - 1, to))]?.focus()
  }
  // Wird die Ansicht schmal (Zoom 200 %), während der Fokus in der Liste steht, verschwindet die Liste mit ihm. Dann
  // geht der Fokus auf die Überschrift des Begriffs statt auf body (Durchsicht von Teil 3, S2). Gemerkt wird der
  // letzte Eintrag mit Fokus, denn mancher Browser setzt den Fokus beim Ausblenden selbst auf body.
  const listRef = useRef<HTMLDivElement>(null)
  const lastInList = useRef<HTMLElement | null>(null)
  const term = useRef(state.term)
  term.current = state.term
  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const was = lastInList.current
      const now = document.activeElement
      if (!was || !term.current || isShown(was) || (now !== was && now !== document.body && now !== null)) return
      lastInList.current = null
      document.getElementById(`begriff-${term.current}`)?.focus({ preventScroll: true })
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="@container">
      <p role="status" className="sr-only">{announce}</p>
      <div role="group" aria-label="Thema" className="no-print flex flex-wrap gap-2 mb-5">
        {lexiconFilters().map((f) => (
          <button
            key={f.topic ?? 'alle'}
            type="button"
            aria-pressed={state.topic === f.topic}
            onClick={() => onTopic(f.topic)}
            className="btn secondary small rounded-full aria-pressed:bg-accent-soft aria-pressed:text-accent-strong aria-pressed:border-accent"
          >
            {f.label} <span className="tabular-nums">{f.count}</span><span className="sr-only"> {plural(f.count, 'Begriff', 'Begriffe')}</span>
          </button>
        ))}
      </div>
      <div className="lexicon-layout" data-pane={lexiconPane(state.term)}>
        <div
          ref={listRef}
          className="lexicon-list"
          onFocus={(e) => { lastInList.current = e.target }}
          onBlur={(e) => { if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) lastInList.current = null }}
        >
          {/* role="list": Safari nimmt einer Liste ohne Aufzählungszeichen sonst die Rolle. Die Buchstaben trennen nur
              fürs Auge; Vorleser hören eine Liste der Begriffe. */}
          <ul role="list" aria-label="Begriffe" className="list-none m-0 p-0 py-1" onKeyDown={onListKey}>
            {entries.map((e) => (
              <li key={e.id}>
                {e.letter && <span aria-hidden="true" className="block px-3 pt-2 pb-1 text-xs font-bold text-muted bg-hover">{e.letter}</span>}
                <button type="button" data-lexicon-term={e.id} tabIndex={stop === e.id ? 0 : -1} aria-current={state.term === e.id ? 'true' : undefined} onFocus={() => setRoving(e.id)} onClick={() => onPick(e.id)}>{e.title}</button>
              </li>
            ))}
          </ul>
        </div>
        <div className="lexicon-term min-w-0">
          {state.term ? <TermDetail id={state.term} onTerm={onTerm} onList={onList} onOpenGuide={onOpenGuide} /> : (
            <p className="m-0 bg-card border border-line rounded-l p-5 text-muted">Wählen Sie einen Begriff aus der Liste.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// Ein Begriff im Lexikon: Thema als Kennzeile, Titel (Ziel des Fokus), Erklärung, Beispiel grün und „Brauche ich das?“
// nebeneinander, Rechtsgrundlage, „Kommt vor in“ (Anleitungen) und verwandte Begriffe desselben Themas.
function TermDetail({ id, onTerm, onList, onOpenGuide }: { id: TermId; onTerm: (id: TermId) => void; onList: () => void; onOpenGuide: (id: GuideId) => void }) {
  const t: Term = GLOSSARY[id]
  const uses = guidesWithTerm(id)
  const related = relatedTerms(id)
  return (
    <article aria-labelledby={`begriff-${id}`} className="@container flex flex-col gap-5 bg-card border border-line rounded-l p-5 shadow-1 wrap-anywhere">
      <button type="button" className="lexicon-back btn secondary small self-start no-print" onClick={onList}>← Zur Liste</button>
      <div>
        <p className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-accent-strong">{TERM_TOPIC_LABELS[t.topic]}</p>
        <h2 id={`begriff-${id}`} tabIndex={-1} className="m-0 text-xl">{t.title}</h2>
      </div>
      <p className="m-0 text-l">{t.short}</p>
      <div className="lexicon-pair">
        <section aria-labelledby={`begriff-${id}-beispiel`} className="bg-green-soft rounded-l px-4 py-3">
          <h3 id={`begriff-${id}-beispiel`} className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-green">Beispiel</h3>
          <p className="m-0">{t.example}</p>
        </section>
        <section aria-labelledby={`begriff-${id}-brauche`} className="bg-accent-soft rounded-l px-4 py-3">
          <h3 id={`begriff-${id}-brauche`} className="m-0 mb-1 text-xs font-bold uppercase tracking-wide text-accent-strong">Brauche ich das?</h3>
          <p className="m-0">{t.needed}</p>
        </section>
      </div>
      {t.norm && (
        <section aria-labelledby={`begriff-${id}-norm`}>
          <h3 id={`begriff-${id}-norm`} className="m-0 mb-2 text-m">Rechtsgrundlage</h3>
          {/* Als Absatz, nicht als Marke wie in der Anleitung: Manche Rechtsgrundlage ist ein ganzer Satz. */}
          <p className="m-0 text-s text-muted">{t.norm}</p>
        </section>
      )}
      {uses.length > 0 && (
        <section aria-labelledby={`begriff-${id}-anleitungen`} className="no-print">
          <h3 id={`begriff-${id}-anleitungen`} className="m-0 mb-2 text-m">Kommt vor in</h3>
          <ul role="list" className="list-none m-0 p-0 flex flex-wrap gap-2">
            {uses.map((g) => (
              <li key={g.id}><button type="button" data-help-key={`guide:${g.id}`} className="btn secondary small text-left" onClick={() => onOpenGuide(g.id)}>{g.title}</button></li>
            ))}
          </ul>
        </section>
      )}
      {related.length > 0 && (
        <section aria-labelledby={`begriff-${id}-verwandt`} className="no-print">
          <h3 id={`begriff-${id}-verwandt`} className="m-0 mb-2 text-m">Verwandte Begriffe</h3>
          <ul role="list" className="list-none m-0 p-0 flex flex-wrap gap-2">
            {related.map((r) => (
              <li key={r.id}><button type="button" className="btn secondary small text-left" onClick={() => onTerm(r.id)}>{r.title}</button></li>
            ))}
          </ul>
        </section>
      )}
    </article>
  )
}

// Eine Anleitung als Kachel: Titel, erster Satz, Zahl der Schritte (Startansicht und „Ähnliche Anleitungen“); als
// Vorschlag oben der Grund in Akzentfarbe.
function GuideTile({ guide: g, onOpen, reason, helpKey = `guide:${g.id}` }: { guide: GuideEntry; onOpen: () => void; reason?: string; helpKey?: string }) {
  return (
    <li className="flex">
      <button type="button" data-help-key={helpKey} onClick={onOpen} className="btn secondary flex w-full flex-col items-start justify-start gap-1 p-4 rounded-l text-left font-normal leading-snug">
        {reason && <span className="text-xs font-bold text-accent-strong wrap-anywhere">{reason}</span>}
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
