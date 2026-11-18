import UIKit
import UniformTypeIdentifiers
import WebKit

final class ShareViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    private var webView: WKWebView?
    private var shareToken = ""
    private var downloads: [ObjectIdentifier: URL] = [:]
    private let baseURL = URL(string: "https://crm-cy-nu.vercel.app")!
    private var payload: [String: String] = [:]
    private let message = UILabel()
    private let actions = UIStackView()
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        view.semanticContentAttribute = .forceRightToLeft
        let title = UILabel(); title.text = "שיתוף ל־CRM CY"; title.font = .preferredFont(forTextStyle: .title2)
        message.numberOfLines = 0; message.text = "קורא את התוכן…"
        actions.axis = .vertical; actions.spacing = 12
        let stack = UIStackView(arrangedSubviews: [title, message, actions])
        stack.axis = .vertical; stack.spacing = 24; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 28),
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)])
        let cancel = UIButton(type: .system); cancel.setTitle("ביטול", for: .normal)
        cancel.addAction(UIAction { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) }, for: .touchUpInside)
        actions.addArrangedSubview(cancel)
        guard let items = extensionContext?.inputItems as? [NSExtensionItem],
              let provider = items.flatMap({ $0.attachments ?? [] }).first else { message.text = "לא התקבל תוכן לשיתוף."; return }
        let fileTypes = provider.registeredTypeIdentifiers.filter { identifier in
            guard let type = UTType(identifier) else { return false }
            return type != .fileURL && type != .url && !type.conforms(to: .plainText)
                && (type.conforms(to: .data) || type.conforms(to: .content))
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { [weak self] item, _ in
                if let url = item as? URL, url.isFileURL, self?.readFile(url, provider: provider) == true { return }
                self?.loadFile(provider, types: fileTypes)
            }
        } else if !fileTypes.isEmpty && !provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            loadFile(provider, types: fileTypes)
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
                let text = (item as? String) ?? (item as? NSAttributedString)?.string ?? ""
                DispatchQueue.main.async { self?.loadedText(text) }
            }
        } else { message.text = "ניתן לשתף קובץ, תמונה או טקסט." }
    }

    private func loadFile(_ provider: NSItemProvider, types: [String]) {
        guard let identifier = types.first else {
            DispatchQueue.main.async { self.message.text = "לא ניתן לקרוא את הקובץ. ניתן לשתף קובץ אחד עד 10MB." }
            return
        }
        provider.loadFileRepresentation(forTypeIdentifier: identifier) { [weak self] url, _ in
            if let url, self?.readFile(url, provider: provider, type: UTType(identifier)) == true { return }
            self?.loadFile(provider, types: Array(types.dropFirst()))
        }
    }

    private func readFile(_ url: URL, provider: NSItemProvider, type: UTType? = nil) -> Bool {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let size = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0, size <= 10 * 1024 * 1024,
              let data = try? Data(contentsOf: url), data.count == size else { return false }
        let kind = UTType(filenameExtension: url.pathExtension) ?? type
        let mime = kind?.preferredMIMEType ?? "application/octet-stream"
        var name = provider.suggestedName ?? url.lastPathComponent
        if URL(fileURLWithPath: name).pathExtension.isEmpty,
           let suffix = kind?.preferredFilenameExtension { name += "." + suffix }
        let fileName = name
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.payload = ["name": fileName, "type": mime, "data": data.base64EncodedString()]
            self.message.text = fileName + "\nבחרו מה לעשות עם הקובץ ב־CRM CY."
            self.addAction("הדפסה", destination: "print")
            if ["application/pdf", "image/png", "image/jpeg", "image/webp"].contains(mime) {
                self.addAction("שיוך לתלמיד", destination: "student")
            }
        }
        return true
    }
    private func loadedText(_ text: String) {
        guard !text.isEmpty, text.utf8.count <= 100_000 else { message.text = "הטקסט ריק או ארוך מדי (עד 100KB)."; return }
        payload = ["text": text]
        message.text = String(text.prefix(220)) + "\n\nאפשר להכניס את הטקסט לתבנית שמורה באפליקציה."
        addAction("הכנסה לתבנית", destination: "template")
    }
    private func addAction(_ title: String, destination: String) {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.filled(); config.title = title; config.cornerStyle = .large
        button.configuration = config
        button.addAction(UIAction { [weak self] _ in self?.save(destination: destination) }, for: .touchUpInside)
        actions.insertArrangedSubview(button, at: 0)
    }
    private func save(destination: String) {
        guard webView == nil else { return }
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.il.co.yeshivatcy.crm"),
              let bytes = try? Data(contentsOf: root.appendingPathComponent("ShareSession.json")),
              let session = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let token = session["token"] as? String,
              let expiry = session["expiresAt"] as? Double, expiry > Date().timeIntervalSince1970 * 1000 else {
            message.text = "פתחו את CRM CY פעם אחת כדי להפעיל את ההתחברות לשיתוף, ואז שתפו שוב."
            return
        }
        shareToken = token
        payload["destination"] = destination
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.userContentController.add(self, name: "mobileAuth")
        let browser = WKWebView(frame: .zero, configuration: configuration)
        browser.navigationDelegate = self
        browser.translatesAutoresizingMaskIntoConstraints = false
        webView = browser
        view.addSubview(browser)
        let close = UIButton(type: .system)
        close.setTitle("סיום", for: .normal)
        close.addAction(UIAction { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) }, for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            close.heightAnchor.constraint(equalToConstant: 44),
            browser.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 8),
            browser.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            browser.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            browser.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        browser.load(URLRequest(url: baseURL.appendingPathComponent("mobile/share-connect")))
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.host == baseURL.host,
              let browser = webView else { return }
        if message.body as? String == "shareConnectReady", browser.url?.path == "/mobile/share-connect" {
            browser.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('crm-share-connect',{detail:{token}}));",
                arguments: ["token": shareToken], in: nil, in: .page, completionHandler: nil)
        }
        if message.body as? String == "importReady", browser.url?.path == "/mobile/import" {
            browser.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('crm-mobile-import',{detail:payload}));",
                arguments: ["payload": payload], in: nil, in: .page, completionHandler: nil)
        }
        if message.body as? String == "importCompleted" { payload = [:] }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if action.targetFrame?.isMainFrame == false {
            decisionHandler(url.scheme == "https" || url.scheme == "about" ? .allow : .cancel)
        } else {
            decisionHandler(url.scheme == "https" && (url.host == baseURL.host || url.host?.hasSuffix(".accounts.dev") == true) ? .allow : .cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().contains("attachment") ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(URL(fileURLWithPath: suggestedFilename).lastPathComponent)
            downloads[ObjectIdentifier(download)] = url
            completionHandler(url)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        present(sheet, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) {
            try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
        }
        let alert = UIAlertController(title: "ההורדה נכשלה", message: "נסו שוב מתוך חלון השיתוף.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "אישור", style: .default))
        present(alert, animated: true)
    }
}
