// Wächter zu den Beschriftungen im Verlauf (#318, eingeführt mit #281): Jede Spalte aus server/src/db/schema.ts hat in
// journalView.ts eine Beschriftung wie im Formular, oder sie steht hier mit Grund. Ohne Beschriftung zeigt der Verlauf
// den Spaltennamen („designated_month“), und den versteht kein Vermieter.
//
// Die Lücken von vor dem Wächter stehen in `BACKLOG`; die Liste darf nur kürzer werden. Wer eine neue Spalte anlegt,
// gibt ihr eine Beschriftung (#96 PR 2 und #262 PR 1 erweitern den Wächter um ihre Spalten).
import { describe, expect, test } from 'vitest'
import { fieldLabel } from './journalView'

// Gelesen mit node:fs wie in uiRules.test.ts.
const fsModule = 'node:fs'
const fs = (await import(/* @vite-ignore */ fsModule)) as { readFileSync: (path: URL, encoding: 'utf8') => string }
const schema = fs.readFileSync(new URL('../../server/src/db/schema.ts', import.meta.url), 'utf8')
const columns = new Set([...schema.matchAll(/\b(?:text|integer|real|blob)\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1] ?? ''))

// Mit eigenem Grund.
const EXCEPTIONS: Record<string, string> = {
  id: 'Kennung, steht im Verlauf nicht (HIDDEN in journalView.ts).',
  property_id: 'Verweis aufs Objekt, steht im Verlauf nicht (HIDDEN in journalView.ts).',
}

// Noch ohne Beschriftung (Stand #281); der Verlauf zeigt dort den Spaltennamen. Nur streichen, nie ergänzen.
const BACKLOG: readonly string[] = [
  'above_70_agreed', 'after', 'agreed_otherwise', 'ai_extra_instructions', 'ai_json_mode', 'ai_max_output_tokens',
  'ai_num_ctx', 'ai_page_image_edge', 'ai_reasoning_effort', 'ai_timeout_seconds', 'amounts_adjusted',
  'area_basis_heat', 'assessment_id', 'at', 'barrier', 'before', 'billed_from', 'billed_to', 'bio_cost_cents',
  'booking', 'building_application_before_2026_05_13', 'building_with', 'cable_built_before_dec_2021', 'capture',
  'capture_installed_on', 'captured_on_2024_10_01', 'category_guessed', 'cause', 'cents', 'change_split',
  'claimed_at', 'climate_factor', 'climate_factor_prev', 'climate_factor_source', 'closing_measured_on',
  'closing_quantity', 'co2_cents', 'co2_cost_cents', 'commercial_metered', 'commercial_use', 'confirmed',
  'consumer_contract', 'contracting', 'created_at', 'credit_note_kind', 'delivered_at', 'delivery_id',
  'detected_year', 'devices_installed_after_2021_12', 'devices_remote', 'dhw_heat_kwh', 'dhw_method', 'dhw_temp_c',
  'dhw_unmeasurable', 'dhw_volume_m3', 'dismissed', 'district_ets_new', 'doc', 'emergency_install',
  'emergency_prior_duty', 'emission_factor', 'emissions_kg', 'ends_on', 'energy_kwh', 'entered_at', 'estimated',
  'exemption', 'exemption_billing_agreed', 'exemption_scope', 'external_measure', 'external_total',
  'external_total_cents', 'file', 'fixed_cents', 'from_month', 'from_period', 'fuel_delivery_id', 'fuel_grade',
  'gas_basis', 'gmodg43_installed_on', 'grid_fee_cents', 'group_id', 'half_split_from', 'half_split_notice_on',
  'hca_model', 'hca_scale', 'heat_consumption_pct', 'heat_delivery_since', 'heat_generation',
  'heat_pump_installed_on', 'heat_pump_majority', 'heat_unit', 'heat_value', 'heated_area_m2', 'heating_period_id',
  'heating_role', 'heating_target', 'heating_value', 'hot_water', 'house_name', 'idx', 'in_contract',
  'info_comparison_source', 'info_contacts_confirmed', 'info_district_ghg', 'info_district_pef',
  'info_reference_kwh_per_m2', 'info_reference_source', 'info_taxes_text', 'installed_on', 'insulation_rule',
  'interim_for', 'invoice_from', 'invoice_to', 'labor_from_total', 'landlord_address', 'landlord_contact',
  'letter_salutation', 'logo_file', 'margin_bottom', 'margin_left', 'margin_right', 'margin_top', 'method',
  'mime_type', 'mode', 'month', 'monthly_info_elsewhere', 'new_building_first_use', 'new_devices_install',
  'next_idx', 'non_residential', 'ollama_model', 'ollama_url', 'op', 'opening_already_settled', 'opening_co2_cents',
  'opening_cost_cents', 'opening_emissions_kg', 'opening_invoiced_before_2023', 'opening_quantity',
  'operating_power', 'operating_power_basis', 'operating_power_general_id', 'operating_power_handling',
  'operating_power_item_id', 'operating_power_reported', 'own_appliances', 'paid_out_on', 'paper_file', 'paper_next',
  'paper_next_file', 'param_id', 'part', 'participants_limited', 'period_start_month', 'previous_supply',
  'print_adjust_suggestion', 'print_attachments', 'print_fold_marks', 'print_footer', 'print_letter', 'provisional',
  'quantity', 'quantity_unit', 'rating_factor', 'reason', 'reassessed', 'reference_kwh_per_m2', 'reference_source',
  'remote_readable', 'replaces_plant_id', 'request_id', 'requested_period', 'requested_year', 'restriction',
  'reverted_by', 'route', 'row_key', 'schema_steps', 'self_supply_kind', 'sent_on', 'separate_settlement',
  'service_area_m2', 'service_cost_item_id', 'service_emissions_kg', 'service_fuel_gross_cents',
  'service_fuel_net_cents', 'service_kg_per_m2', 'service_landlord_cents', 'service_landlord_permille',
  'service_self_landlord_cents', 'service_total_cents', 'service_units_count', 'service_users_total_approx',
  'service_users_total_cents', 'settle_period', 'settlement', 'sha256', 'share_permille', 'size_bytes', 'source',
  'source_date', 'statement_id', 'status', 'stock_unit', 'subject_table', 'supplier_billed_at', 'supply',
  'switch_announced_on', 'table_name', 'takes_over_stock', 'tight_market', 'tight_market_from', 'tight_market_to',
  'to', 'to_month', 'total_gross_cents', 'total_heat_kwh', 'units_limited', 'until_period', 'update_check',
  'update_dismissed', 'uploaded_at', 'usage', 'used_by_service', 'valid_from', 'value_json', 'value_unit',
  'volume_m3', 'warm_rent_average_2022_2024', 'water_consumption_pct', 'water_value',
]
const BACKLOG_SIZE = 233

describe('Verlauf: jede Spalte hat eine Beschriftung (#281)', () => {
  test('der Wächter sieht das Schema', () => {
    expect(columns.size).toBeGreaterThan(200)
    expect(columns).toContain('designated_month')
  })

  test('jede Spalte hat eine Beschriftung oder steht mit Grund in einer Ausnahmeliste', () => {
    const missing = [...columns].filter((c) => fieldLabel(c) === c && !Object.hasOwn(EXCEPTIONS, c) && !BACKLOG.includes(c))
    expect(missing, 'Beschriftung in FIELD_LABELS (journalView.ts) ergänzen').toEqual([])
  })

  test('die Ausnahmeliste wird nur kürzer: kein Eintrag mit Beschriftung, keiner ohne Spalte, keiner dazu', () => {
    const stale = [...BACKLOG, ...Object.keys(EXCEPTIONS)].filter((c) => !columns.has(c) || (fieldLabel(c) !== c && !Object.hasOwn(EXCEPTIONS, c)))
    expect(stale, 'beschriftet oder entfallen: aus der Liste streichen').toEqual([])
    expect(new Set(BACKLOG).size).toBe(BACKLOG.length)
    expect(BACKLOG.length).toBeLessThanOrEqual(BACKLOG_SIZE)
    for (const [c, reason] of Object.entries(EXCEPTIONS)) expect(reason.trim(), c).not.toBe('')
  })

  test('der Monat laut Verwendungszweck heißt wie am Feld', () => {
    expect(fieldLabel('designated_month')).toBe('Für Monat (laut Verwendungszweck)')
  })

  // #96 PR 2 (Entwurf B2, Release-Plan „FIELD_LABELS“): die Kopfangaben der Anlage V und das Kennzeichen am Mietverhältnis.
  test('die Kopfangaben der Anlage V heißen wie im Plan', () => {
    expect(columns).toContain('ground_tax_file_number')
    expect(columns).toContain('relative')
    expect(fieldLabel('ground_tax_file_number')).toBe('Aktenzeichen (Grundsteuer)')
    expect(fieldLabel('purchase_contract_on')).toBe('Kaufvertrag vom')
    expect(fieldLabel('ownership_transfer_on')).toBe('Eigentumsübergang am')
    expect(fieldLabel('building_application_on')).toBe('Bauantrag vom')
    expect(fieldLabel('completed_on')).toBe('Fertiggestellt am')
    expect(fieldLabel('relative')).toBe('An Angehörige vermietet')
  })
})
