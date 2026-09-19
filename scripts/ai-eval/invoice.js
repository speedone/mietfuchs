// Darstellung der Beispielbelege für den KI-Prüflauf: ?page=N zeigt nur diese Seite (für
// Screenshots je Seite), ?scan und ?photo ahmen einen Scanner bzw. ein Handyfoto nach.
const params = new URLSearchParams(location.search)
const page = Number(params.get('page'))
if (page) document.querySelectorAll('.page').forEach((el, i) => { if (i + 1 !== page) el.remove() })
for (const look of ['scan', 'photo']) if (params.has(look)) document.documentElement.classList.add(look)
