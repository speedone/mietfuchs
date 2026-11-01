// Typen für scripts/store-submit.mjs, damit server/test/store-submit.test.ts sie prüfen kann.
export const APP_ID: string
export const LANGUAGE: string
export const SCREENSHOTS: { file: string, description: string }[]
export function parseListing(md: string): { description: string, features: string[], keywords: string[] }
export function releaseNotes(tag: string, repository?: string): string
export function buildSubmission(
  submission: any,
  input: { bundle: string, tag: string, listing: { description: string, features: string[], keywords: string[] }, notes: string },
): any
export function commitOutcome(status: { status?: string, statusDetails?: any }): 'wait' | 'ok' | 'failed'
export function draftHint(message: string): string | null
