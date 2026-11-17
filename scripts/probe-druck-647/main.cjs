// Probe zu #647: eine Seite wie das Anschreiben (A4, @page 12 mm, Block 269 mm mit Fuß unten, Falz- und Lochmarken bei
// 105/148,5/210 mm vom Blattrand) und Druck über printToPDF oder webContents.print, wie der Menüpunkt „Drucken“.
// MODE: list | pdf | print;  OPTS: JSON der Optionen;  OUT: Ziel bei pdf.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const mode = process.env.MODE || 'list'
const html = `<!doctype html><html><head><style>
@page { size: A4; margin: 12mm; }
body { margin: 0; font: 11pt sans-serif; }
.letter { position: relative; min-height: calc(297mm - 24mm - 4mm); }
.mark { position: absolute; left: 0; width: 5mm; border-top: 0.3mm solid #000; }
.foot { position: absolute; bottom: 0; left: 13mm; right: 8mm; border-top: 0.2mm solid #000; font-size: 7.5pt; }
</style></head><body><div class="letter">
<p style="margin:0">OBEN Absender</p>
<div class="mark" style="top:93mm"></div><div class="mark" style="top:136.5mm;width:8mm"></div><div class="mark" style="top:198mm"></div>
<div class="foot">FUSSZEILE Klaus Wegener Tel. 0123</div></div>
<script>document.title = 'Probe ' + devicePixelRatio</script></body></html>`
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1200, height: 900, show: true })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const wc = win.webContents
  console.log('devicePixelRatio', await wc.executeJavaScript('devicePixelRatio'))
  if (mode === 'list') {
    console.log(JSON.stringify((await wc.getPrintersAsync()).map((p) => ({ name: p.name, isDefault: p.isDefault }))))
    return app.quit()
  }
  if (mode === 'pdf') {
    fs.writeFileSync(process.env.OUT, await wc.printToPDF(JSON.parse(process.env.OPTS || '{}')))
    return app.quit()
  }
  const opts = { printBackground: true, ...JSON.parse(process.env.OPTS || '{}') }
  console.log('print', JSON.stringify(opts))
  wc.print(opts, (ok, reason) => { console.log('ergebnis', ok, reason); setTimeout(() => app.quit(), 4000) })
})
