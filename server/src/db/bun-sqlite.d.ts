// `bun:sqlite` gibt es nur in der Bun-Laufzeit, Typen dafür liefert `@types/node` naturgemäß
// nicht. Das ganze Paket `bun-types` dafür einzuziehen wäre zu viel: Es bringt eigene globale
// Deklarationen mit, die sich mit denen von `@types/node` überschneiden, und wir brauchen von
// Bun genau vier Dinge.
//
// Deshalb hier nur der Ausschnitt, den client.ts wirklich benutzt, und zwar so eng wie Buns
// eigene Dokumentation ihn beschreibt. Enger ist besser als weiter: Eine zu weite Deklaration
// verspricht etwas, das die Laufzeit nicht hält, und der Übersetzer schwiege dazu.
declare module 'bun:sqlite' {
  // Was Bun als Parameter annimmt (`SQLQueryBindings`), ohne die Form mit benannten
  // Parametern, die wir nicht verwenden.
  type Binding = string | number | bigint | boolean | null | Uint8Array

  // Was `run` und `exec` zurückgeben.
  type Changes = { changes: number; lastInsertRowid: number | bigint }

  export class Statement {
    // Zeilen als Wertelisten. Das Gegenstück zu `setReturnArrays(true)` bei node:sqlite.
    values(...params: Binding[]): unknown[][]
    run(...params: Binding[]): Changes
  }
  export class Database {
    constructor(filename?: string)
    // `query` merkt sich die vorbereitete Anweisung je SQL-Text, `prepare` nicht. Weil Drizzle
    // uns denselben SQL-Text immer wieder reicht, ist `query` hier das Richtige.
    query(sql: string): Statement
    exec(sql: string, ...params: Binding[]): Changes
    close(): void
  }
}
