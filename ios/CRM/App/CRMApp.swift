import SwiftUI
import WebKit
import AuthenticationServices
import CryptoKit
import Security

@main
struct CRMApp: App {
    var body: some Scene {
        WindowGroup { CRMRootView().environment(\.layoutDirection, .rightToLeft) }
    }
}

struct CRMRootView: View {
    @StateObject private var browser = CRMBrowser()
    @Environment(\.scenePhase) private var scenePhase
    private let tabs: [(String, String, String)] = [
        ("/attendance", "נוכחות", "checkmark.circle"),
        ("/neon", "תלמידים", "person.2"),
        ("/tasks", "משימות", "checklist"),
        ("/account", "החשבון שלי", "person.crop.circle")
    ]
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("CRM CY").font(.headline)
                Spacer()
                Button { browser.goBack() } label: { Image(systemName: "chevron.forward") }
                    .disabled(!browser.canGoBack).accessibilityLabel("חזרה למסך הקודם")
                Button { browser.reload() } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("רענון")
                Menu {
                    Button("התחברות מחדש", action: browser.restartSignIn)
                    Button("שיתוף שממתין לטיפול", action: browser.showSharedImport)
                    Button("פתיחה ב־Safari", action: browser.openInSafari)
                } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("אפשרויות")
            }
            .buttonStyle(.bordered).padding(.horizontal, 16).padding(.vertical, 8)
            if browser.loading { ProgressView().progressViewStyle(.linear).accessibilityLabel("טוען") }
            ZStack {
                CRMWebView(browser: browser)
                if let error = browser.error {
                    VStack(spacing: 18) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                        Text(error).multilineTextAlignment(.center)
                        Button("נסה שוב", action: browser.reload).buttonStyle(.borderedProminent)
                        Button("התחברות", action: browser.restartSignIn).buttonStyle(.bordered)
                    }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(.background)
                }
            }
            HStack(spacing: 0) {
                ForEach(tabs, id: \.0) { path, title, icon in
                    Button { browser.navigate(path) } label: {
                        VStack(spacing: 4) {
                            Image(systemName: icon).font(.title3)
                            Text(title).font(.caption)
                        }.frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .foregroundStyle(browser.selectedPath == path ? Color.accentColor : .secondary)
                    .accessibilityAddTraits(browser.selectedPath == path ? .isSelected : [])
                }
            }.padding(.horizontal, 8).padding(.top, 6).background(.bar)
        }
        .onChange(of: scenePhase) { _, phase in if phase == .active { browser.checkSharedInbox() } }
        .tint(Color(red: 0.09, green: 0.30, blue: 0.65))
    }
}

struct CRMWebView: UIViewRepresentable {
    @ObservedObject var browser: CRMBrowser
    func makeUIView(context: Context) -> WKWebView { browser.webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

@MainActor
final class CRMBrowser: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandler, WKDownloadDelegate, ASWebAuthenticationPresentationContextProviding {
    @Published var loading = false
    @Published var canGoBack = false
    @Published var selectedPath = "/attendance"
    @Published var error: String?
    let webView: WKWebView
    let baseURL: URL
    private var authentication: ASWebAuthenticationSession?
    private var verifier: String?
    private var authState: String?
    private var pendingCode: String?
    private var activeImport: URL?
    private var importedPayload: [String: String]?
    private var resumeImportAfterAuth = false
    private var downloads: [ObjectIdentifier: URL] = [:]

    override init() {
        baseURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "CRMBaseURL") as? String
                      ?? "https://crm-cy-nu.vercel.app")!
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let css = ".mobile-navigation{display:none!important}body:has(.mobile-navigation){padding-bottom:0!important}input,select,textarea{font-size:max(16px,1em)}"
        let encoded = String(data: try! JSONEncoder().encode(css), encoding: .utf8)!
        configuration.userContentController.addUserScript(WKUserScript(source:
            "const crmStyle=document.createElement('style');crmStyle.textContent=\(encoded);document.head.appendChild(crmStyle);",
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        configuration.userContentController.add(self, name: "mobileAuth")
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isInspectable = false
        navigate("/attendance")
    }

    func navigate(_ path: String) {
        guard !loading || webView.url?.path != path else { return }
        selectedPath = path
        error = nil
        webView.load(URLRequest(url: baseURL.appendingPathComponent(String(path.dropFirst()))))
    }
    func goBack() { webView.goBack() }
    func reload() { error = nil; if webView.url == nil { navigate(selectedPath) } else { webView.reload() } }
    func openInSafari() { UIApplication.shared.open(webView.url ?? baseURL) }

    private func randomSecret() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return Data(bytes).base64URLEncodedString()
    }
    func restartSignIn() {
        let previous = authentication
        authentication = nil
        verifier = nil; authState = nil; pendingCode = nil
        previous?.cancel()
        // The cancelled session's callback must not overwrite the next attempt.
        Task { @MainActor in signIn() }
    }
    func signIn() {
        guard authentication == nil else { return }
        error = nil; loading = false
        guard let verifier = randomSecret(), let state = randomSecret() else {
            error = "לא ניתן להתחיל כניסה מאובטחת. נסו שוב."; return
        }
        resumeImportAfterAuth = activeImport != nil
        self.verifier = verifier
        authState = state
        var components = URLComponents(url: baseURL.appendingPathComponent("mobile/connect"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "challenge", value: Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncodedString()),
            URLQueryItem(name: "state", value: state)
        ]
        let session = ASWebAuthenticationSession(url: components.url!, callbackURLScheme: "crmcy") { [weak self] url, failure in
            Task { @MainActor in
                guard let self else { return }
                guard self.authState == state else { return }
                self.authentication = nil
                self.loading = false
                guard failure == nil, let url,
                      url.scheme == "crmcy", url.host == "auth",
                      let callback = URLComponents(url: url, resolvingAgainstBaseURL: false),
                      callback.queryItems?.first(where: { $0.name == "state" })?.value == self.authState,
                      let code = callback.queryItems?.first(where: { $0.name == "code" })?.value,
                      code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else {
                    self.verifier = nil; self.authState = nil
                    self.error = "הכניסה לא הושלמה. אפשר להתחבר שוב."; return
                }
                self.pendingCode = code
                self.error = nil
                self.webView.load(URLRequest(url: self.baseURL.appendingPathComponent("mobile/finish")))
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authentication = session
        if !session.start() {
            authentication = nil; self.verifier = nil; authState = nil
            error = "לא ניתן לפתוח חלון התחברות. נסו להתחבר שוב."
        }
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        webView.window ?? ASPresentationAnchor()
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == baseURL.host else { return }
        if webView.url?.path == "/mobile/import" {
            if message.body as? String == "importReady", let payload = importedPayload {
                webView.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('crm-mobile-import',{detail:payload}));",
                    arguments: ["payload": payload], in: nil, in: .page, completionHandler: nil)
            } else if message.body as? String == "importCompleted" {
                if let activeImport { try? FileManager.default.removeItem(at: activeImport) }
                activeImport = nil; importedPayload = nil
            }
            return
        }
        // Print upload completion is accepted only from its authorized web workflow.
        if message.body as? String == "importCompleted", webView.url?.path == "/print" {
            if let activeImport { try? FileManager.default.removeItem(at: activeImport) }
            activeImport = nil; importedPayload = nil; return
        }
        guard webView.url?.path == "/mobile/finish", message.body as? String == "ready",
              let code = pendingCode, let verifier else { return }
        pendingCode = nil; self.verifier = nil; authState = nil
        webView.callAsyncJavaScript(
            "window.dispatchEvent(new CustomEvent('crm-mobile-auth',{detail:{code,verifier}}));",
            arguments: ["code": code, "verifier": verifier], in: nil, in: .page, completionHandler: { [weak self] result in
                if case .failure = result { self?.error = "הכניסה לא הושלמה. התחברו מחדש." }
            })
    }
    func showSharedImport() {
        if activeImport != nil { navigate("/mobile/import") } else { checkSharedInbox() }
    }
    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        decisionHandler(!response.canShowMIMEType || disposition.lowercased().contains("attachment") ? .download : .allow)
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let destination = folder.appendingPathComponent(URL(fileURLWithPath: suggestedFilename).lastPathComponent)
            downloads[ObjectIdentifier(download)] = destination; completionHandler(destination)
        } catch { completionHandler(nil) }
    }
    func downloadDidFinish(_ download: WKDownload) {
        loading = false
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, _, _, _ in try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        guard let root = webView.window?.rootViewController else { return }
        var presenter = root
        while let presented = presenter.presentedViewController { presenter = presented }
        sheet.popoverPresentationController?.sourceView = webView
        presenter.present(sheet, animated: true)
    }
    func download(_ download: WKDownload, didFailWithError failure: Error, resumeData: Data?) {
        if let url = downloads.removeValue(forKey: ObjectIdentifier(download)) { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        loading = false; error = "הורדת הקובץ נכשלה. נסו שוב."
    }
    func checkSharedInbox() {
        guard authentication == nil, pendingCode == nil, activeImport == nil,
              let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.il.co.yeshivatcy.crm") else { return }
        let folder = root.appendingPathComponent("SharedInbox")
        guard let urls = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.creationDateKey, .fileSizeKey]) else { return }
        for url in urls.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where url.pathExtension == "json" {
            guard let values = try? url.resourceValues(forKeys: [.creationDateKey, .fileSizeKey]),
                  Date().timeIntervalSince(values.creationDate ?? .distantPast) < 86400,
                  (values.fileSize ?? 0) < 15_000_000 else { try? FileManager.default.removeItem(at: url); continue }
            guard let bytes = try? Data(contentsOf: url),
                  let payload = try? JSONSerialization.jsonObject(with: bytes) as? [String: String] else { continue }
            activeImport = url; importedPayload = payload
            navigate("/mobile/import"); return
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        switch CRMNavigationPolicy.destination(url: url, baseURL: baseURL,
            isMainFrame: action.targetFrame?.isMainFrame, sourceHost: action.sourceFrame.securityOrigin.host) {
        case .embedded: decisionHandler(.allow)
        case .authenticate:
            loading = false; error = nil
            decisionHandler(.cancel)
            // Present only after WebKit has finished cancelling its navigation.
            Task { @MainActor in self.signIn() }
        case .external:
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        case .blocked: decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if url.host == baseURL.host { webView.load(action.request) }
            else if ["https", "http", "tel", "mailto"].contains(url.scheme ?? "") { UIApplication.shared.open(url) }
        }
        return nil
    }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true; error = nil }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false; canGoBack = webView.canGoBack
        if webView.url?.path != "/mobile/finish" && webView.url?.path != "/mobile/import" {
            if activeImport != nil && importedPayload != nil {
                // Resume a pending share after a system authentication round trip.
                if resumeImportAfterAuth && webView.url?.path == "/attendance" {
                    resumeImportAfterAuth = false
                    webView.load(URLRequest(url: baseURL.appendingPathComponent("mobile/import"))); return
                }
            } else { checkSharedInbox() }
        }
        if let path = webView.url?.path {
            if path.hasPrefix("/attendance") { selectedPath = "/attendance" }
            else if path.hasPrefix("/neon") || path.hasPrefix("/students") { selectedPath = "/neon" }
            else if path.hasPrefix("/tasks") { selectedPath = "/tasks" }
            else if path.hasPrefix("/account") { selectedPath = "/account" }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError failure: Error) { fail(failure) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError failure: Error) { fail(failure) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { reload() }
    private func fail(_ failure: Error) {
        let navigationError = failure as NSError
        guard !CRMNavigationPolicy.isExpectedCancellation(navigationError) else { return }
        // A previous, interrupted web navigation may finish while system auth is on screen.
        guard authentication == nil, pendingCode == nil else { return }
        loading = false; error = "לא ניתן לטעון את המערכת. בדקו את החיבור לאינטרנט ונסו שוב."
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
