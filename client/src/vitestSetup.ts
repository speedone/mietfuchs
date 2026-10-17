// Läuft vor jeder Testdatei (`setupFiles` in vite.config.ts). `findBy…` und `waitFor` warten
// voreingestellt nur eine Sekunde; unter Last (voller Testlauf, Server- und Client-Tests parallel)
// scheiterten so Belege, propertyCreate und AiSettings gelegentlich, ohne dass etwas falsch war
// (Durchsicht von #221). Ein Element, das wirklich nie erscheint, fällt auch nach fünf Sekunden auf.
import { configure } from '@testing-library/react'

configure({ asyncUtilTimeout: 5000 })
