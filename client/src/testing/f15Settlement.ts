// Die Abrechnung des Golden F15 (Techem-Muster mit Vorwegabzug), wie der Server sie rechnet, ohne den Rechenweg
// (`steps`). Eingefroren für die Kontrollansicht (#321); server/test/controlview-f15.test.ts hält sie gleich mit
// der Berechnung. Nur Typen werden importiert, damit der Server die Datei laden kann.
import type { Settlement } from '../../../shared/types.ts'

export const f15Settlement: Pick<Settlement, 'statements' | 'landlord'> = {
  "statements": [
    {
      "tenancyId": "ta",
      "tenantName": "Mieter 1",
      "unitId": "a",
      "unitName": "W1",
      "persons": 1,
      "personDays": 365,
      "days": 365,
      "periodStart": "2025-01-01",
      "periodEnd": "2025-12-31",
      "rows": [
        {
          "costItemId": "hz",
          "category": "Heizung und Warmwasser",
          "description": "Heizung und Warmwasser laut Messdienst",
          "totalCents": 393301,
          "key": "amounts",
          "keyLabel": "Einzelbetrag",
          "basisText": "laut Einzelabrechnung",
          "shareCents": 110327,
          "labor35aCents": 0
        }
      ],
      "totalShareCents": 110327,
      "total35aCents": 0,
      "prepaymentCents": 0,
      "prepaymentOverridden": false,
      "suggestedMonthlyCents": 9200,
      "balanceCents": -110327
    },
    {
      "tenancyId": "tb",
      "tenantName": "Mieter 2",
      "unitId": "b",
      "unitName": "W2",
      "persons": 1,
      "personDays": 365,
      "days": 365,
      "periodStart": "2025-01-01",
      "periodEnd": "2025-12-31",
      "rows": [
        {
          "costItemId": "hz",
          "category": "Heizung und Warmwasser",
          "description": "Heizung und Warmwasser laut Messdienst",
          "totalCents": 393301,
          "key": "amounts",
          "keyLabel": "Einzelbetrag",
          "basisText": "laut Einzelabrechnung",
          "shareCents": 95864,
          "labor35aCents": 0
        }
      ],
      "totalShareCents": 95864,
      "total35aCents": 0,
      "prepaymentCents": 0,
      "prepaymentOverridden": false,
      "suggestedMonthlyCents": 8000,
      "balanceCents": -95864
    },
    {
      "tenancyId": "tc",
      "tenantName": "Mieter 3",
      "unitId": "c",
      "unitName": "W3",
      "persons": 1,
      "personDays": 365,
      "days": 365,
      "periodStart": "2025-01-01",
      "periodEnd": "2025-12-31",
      "rows": [
        {
          "costItemId": "hz",
          "category": "Heizung und Warmwasser",
          "description": "Heizung und Warmwasser laut Messdienst",
          "totalCents": 393301,
          "key": "amounts",
          "keyLabel": "Einzelbetrag",
          "basisText": "laut Einzelabrechnung",
          "shareCents": 101485,
          "labor35aCents": 0
        }
      ],
      "totalShareCents": 101485,
      "total35aCents": 0,
      "prepaymentCents": 0,
      "prepaymentOverridden": false,
      "suggestedMonthlyCents": 8500,
      "balanceCents": -101485
    },
    {
      "tenancyId": "td",
      "tenantName": "Mieter 4",
      "unitId": "d",
      "unitName": "W4",
      "persons": 1,
      "personDays": 365,
      "days": 365,
      "periodStart": "2025-01-01",
      "periodEnd": "2025-12-31",
      "rows": [
        {
          "costItemId": "hz",
          "category": "Heizung und Warmwasser",
          "description": "Heizung und Warmwasser laut Messdienst",
          "totalCents": 393301,
          "key": "amounts",
          "keyLabel": "Einzelbetrag",
          "basisText": "laut Einzelabrechnung",
          "shareCents": 76875,
          "labor35aCents": 0
        }
      ],
      "totalShareCents": 76875,
      "total35aCents": 0,
      "prepaymentCents": 0,
      "prepaymentOverridden": false,
      "suggestedMonthlyCents": 6400,
      "balanceCents": -76875
    }
  ],
  "landlord": {
    "rows": [
      {
        "costItemId": "hz",
        "category": "Heizung und Warmwasser",
        "description": "Heizung und Warmwasser laut Messdienst",
        "totalCents": 393301,
        "keyLabel": "Einzelbetrag",
        "shareCents": 8750,
        "landlordParts": [
          {
            "reason": "co2Share",
            "cents": 8750
          }
        ]
      }
    ],
    "totalCents": 8750
  }
}
