// Druckt eine Seite von Mietfuchs so, wie Safari sie mit „Als PDF sichern“ druckt: WKWebView (dieselbe Engine wie
// Safari auf diesem Mac) und NSPrintOperation mit der Job-Disposition „save“ (#286). Aufgerufen von
// scripts/safari-print-check.mjs, einmal je Fall:
//
//   safari-print --url <Adresse> --prelude <datei.js> --driver <datei.js> --args <json> --out <datei.pdf>
//
// `prelude` läuft vor jedem Skript der Seite (WKUserScript, documentStart), `driver` ist der Rumpf einer async-Funktion,
// die die Oberfläche bis zum Druck bedient (callAsyncJavaScript, Argument `args`). Danach druckt das Programm, nicht die
// Seite: `window.print()` fängt das Vorspiel ab, denn ein WKWebView ohne Safari darum öffnet bei `window.print()` keinen
// Druck. Was die Seite vor `window.print()` setzt (Klasse `print-one`, Titel, Randfelder für die Seitenzahl), steht
// dann noch da, genau wie in Safari, während der Druckdialog offen ist.
//
// Gebaut ohne Xcode-Projekt: `swiftc -O scripts/safari-print/main.swift -o <ziel>`. Ausgabe: eine Zeile JSON auf
// stdout (Ergebnis des Treibers, Druckeinstellungen), Meldungen der Seite auf stderr. Exit 0 nur mit geschriebener PDF.
import AppKit
import WebKit

func argument(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}
func fail(_ text: String) -> Never {
  FileHandle.standardError.write("safari-print: \(text)\n".data(using: .utf8)!)
  exit(1)
}
// Als Werte des Moduls, nicht über `guard let` (dessen Namen sähe die Klasse unten nicht)
let url: URL = {
  guard let text = argument("--url"), let url = URL(string: text) else { fail("--url fehlt") }
  return url
}()
let outPath: String = argument("--out") ?? fail("--out fehlt")
let prelude = (try? String(contentsOfFile: argument("--prelude") ?? "", encoding: .utf8)) ?? ""
let driver: String = (try? String(contentsOfFile: argument("--driver") ?? "", encoding: .utf8)) ?? fail("--driver fehlt")
let argsJSON = argument("--args") ?? "{}"
let timeoutSeconds = Double(argument("--timeout") ?? "120") ?? 120

// A4 in Punkt
let a4 = NSSize(width: 595.2756, height: 841.8898)

@MainActor
final class Runner: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let window: NSWindow
  let webView: WKWebView
  var loaded = false
  var driverResult: Any = NSNull()

  override init() {
    let config = WKWebViewConfiguration()
    // Ein frischer Speicher je Lauf, wie ein neues Profil; nichts bleibt vom Fall davor.
    config.websiteDataStore = .nonPersistent()
    let controller = WKUserContentController()
    controller.addUserScript(WKUserScript(source: prelude, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    config.userContentController = controller
    // Safaris Vorgabe: „Hintergründe drucken“ aus.
    if #available(macOS 13.3, *) { config.preferences.shouldPrintBackgrounds = false }
    let frame = NSRect(x: 0, y: 0, width: 1440, height: 900)
    webView = WKWebView(frame: frame, configuration: config)
    window = NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
    super.init()
    controller.add(self, name: "mietfuchs")
    webView.navigationDelegate = self
    window.contentView = webView
    window.orderFrontRegardless()
  }

  func start() {
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) { fail("Zeitüberschreitung nach \(Int(timeoutSeconds)) s (geladen: \(self.loaded))") }
    webView.load(URLRequest(url: url))
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    let text = "\(message.body)"
    FileHandle.standardError.write("seite: \(text)\n".data(using: .utf8)!)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail("Laden fehlgeschlagen: \(error)") }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("Laden fehlgeschlagen: \(error)") }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if loaded { return }
    loaded = true
    let body = "const args = JSON.parse(argsJSON);\nreturn await (\(driver))(args);"
    webView.callAsyncJavaScript(body, arguments: ["argsJSON": argsJSON], in: nil, in: .page) { result in
      switch result {
      case .failure(let error): fail("Treiber: \(error)")
      case .success(let value):
        self.driverResult = value
        // Ein Atemzug für Bilder und Schriften nach dem letzten Schritt des Treibers
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.printPDF() }
      }
    }
  }

  func printPDF() {
    let info = (NSPrintInfo.shared.copy() as? NSPrintInfo) ?? NSPrintInfo()
    info.paperSize = a4
    info.orientation = .portrait
    // Die Ränder bleiben die Vorgabe von NSPrintInfo, wie in Safari ohne eigene Seiteneinstellung; die Seite setzt ihre
    // eigenen über `@page { margin }` (WebKit kennt diese Angabe seit Safari 18.2).
    info.jobDisposition = .save
    info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL.rawValue] = URL(fileURLWithPath: outPath)
    info.isHorizontallyCentered = false
    info.isVerticallyCentered = false
    let op = webView.printOperation(with: info)
    op.showsPrintPanel = false
    op.showsProgressPanel = false
    // Ohne Rahmen druckt WKWebView leere Seiten (bekannt aus WebKit, nachgemessen in der Probe)
    op.view?.frame = webView.bounds
    let settings: [String: Any] = [
      "leftMargin": info.leftMargin, "rightMargin": info.rightMargin, "topMargin": info.topMargin, "bottomMargin": info.bottomMargin,
      "paperWidth": info.paperSize.width, "paperHeight": info.paperSize.height,
    ]
    let report: [String: Any] = ["driver": driverResult, "printInfo": settings, "os": ProcessInfo.processInfo.operatingSystemVersionString]
    pendingReport = report
    op.runModal(for: window, delegate: self, didRun: #selector(Runner.printed(_:success:contextInfo:)), contextInfo: nil)
  }
  var pendingReport: [String: Any] = [:]

  @objc func printed(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
    guard success else { fail("Druck nicht erfolgreich") }
    // Die Datei entsteht mitunter erst kurz nach dem Rückruf
    var tries = 0
    func check() {
      if FileManager.default.fileExists(atPath: outPath) {
        if let data = try? JSONSerialization.data(withJSONObject: pendingReport, options: []), let line = String(data: data, encoding: .utf8) {
          print(line)
        }
        exit(0)
      }
      tries += 1
      if tries > 50 { fail("Keine PDF unter \(outPath)") }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { check() }
    }
    check()
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let runner = MainActor.assumeIsolated { Runner() }
DispatchQueue.main.async { MainActor.assumeIsolated { runner.start() } }
app.run()
