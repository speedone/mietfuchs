// `bun:sqlite` gibt es nur in der Bun-Laufzeit, Typen dafür liefert `@types/node` naturgemäß
// nicht. Das ganze Paket `bun-types` dafür einzuziehen wäre zu viel: Es bringt eigene globale
// Deklarationen mit, die sich mit denen von `@types/node` überschneiden, und wir brauchen von
// Bun genau vier Methoden.
//
// Deshalb hier nur der Ausschnitt, den client.ts wirklich benutzt. Das ist keine Behauptung
// über fremden Code, sondern dieselbe Art Deklaration, die ein Typ-Paket auch abgäbe — und sie
// ist absichtlich so schmal, dass man ihr ansieht, worauf wir uns bei Bun verlassen.
declare module 'bun:sqlite' {
  export class Statement {
    // Zeilen als Wertelisten. Das Gegenstück zu `setReturnArrays(true)` bei node:sqlite.
    values(...params: unknown[]): unknown[][]
    run(...params: unknown[]): unknown
  }
  export class Database {
    constructor(filename?: string)
    // `query` merkt sich die vorbereitete Anweisung je SQL-Text, `prepare` nicht. Weil Drizzle
    // uns denselben SQL-Text immer wieder reicht, ist `query` hier das Richtige.
    query(sql: string): Statement
    exec(sql: string): void
    close(): void
  }
}
