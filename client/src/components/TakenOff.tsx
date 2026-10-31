// Ein gespeicherter, nicht ausgewerteter Beleg, den der Nutzer aus der Liste genommen hat (#487): An Stelle des Eintrags
// steht, dass der Beleg weiter im Belegordner liegt, mit dem Weg dorthin. Ein Erfolg ist kein Hinweis, sondern `div.ok`.
export function TakenOff({ fileName, onShow }: { fileName: string; onShow?: () => void }) {
  return (
    <div className="ok flex flex-wrap items-center gap-2" role="status">
      <span>„{fileName}“ liegt weiter im Belegordner.</span>
      {onShow && <button type="button" className="btn small ghost" onClick={onShow}>Im Belegordner zeigen</button>}
    </div>
  )
}
