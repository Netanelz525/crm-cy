import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
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
        guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.il.co.yeshivatcy.crm") else {
            message.text = "השיתוף אינו מוגדר בבנייה זו."; return
        }
        do {
            let folder = root.appendingPathComponent("SharedInbox", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let manifest = folder.appendingPathComponent(UUID().uuidString + ".json")
            payload["destination"] = destination
            let bytes = try JSONSerialization.data(withJSONObject: payload)
            try bytes.write(to: manifest, options: [.atomic, .completeFileProtection])
            actions.arrangedSubviews.forEach { $0.isHidden = true }
            message.text = "נשמר. פתחו את CRM CY ממסך הבית כדי להמשיך לתבנית, להדפסה או לשיוך לתלמיד."
            let done = UIButton(type: .system); done.setTitle("סיום", for: .normal)
            done.addAction(UIAction { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) }, for: .touchUpInside)
            actions.addArrangedSubview(done)
        } catch { message.text = "שמירת השיתוף נכשלה. נסו שוב." }
    }
}
