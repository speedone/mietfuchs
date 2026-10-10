// Die Felder einer Heizperiode zu § 6a, § 11 und § 2 ohne jede Angabe (Heizung PR 14), für Testdaten der
// Karten, die eine `HeatingPeriodView` brauchen.
import type { HeatingPeriodView } from '../types'

export const noInfoView = (): Pick<HeatingPeriodView, 'info' | 'rules' | 'ownRules' | 'centralHotWater' | 'agreeable'> => ({
  info: { infoTaxesText: null, infoDistrictGhg: null, infoDistrictPef: null, climateFactor: null, climateFactorPrev: null, climateFactorSource: null, infoReferenceKwhPerM2: null, infoReferenceSource: null, infoComparisonSource: null, postalCode: null },
  rules: {
    exemption: 'none', exemptionScope: null, exemptionBillingAgreed: false, agreedOtherwise: 'none', monthlyInfoElsewhere: false, consumerContract: null,
    fromPeriod: { exemption: null, agreedOtherwise: null, monthlyInfoElsewhere: null, consumerContract: null },
  },
  ownRules: { exemption: null, exemptionScope: null, exemptionBillingAgreed: null, agreedOtherwise: null, monthlyInfoElsewhere: null, consumerContract: null },
  centralHotWater: true,
  agreeable: false,
})
