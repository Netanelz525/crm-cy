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
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            loadFile(provider, type: UTType.fileURL.identifier)
        } else if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            loadFile(provider, type: UTType.pdf.identifier)
        } else if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            loadFile(provider, type: UTType.image.identifier)
        } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] item, _ in
                let text = (item as? String) ?? (item as? NSAttributedString)?.string ?? ""
                DispatchQueue.main.async { self?.loadedText(text) }
            }
        } else { message.text = "ניתן לשתף קובץ, תמונה או טקסט." }
    }
    private func loadFile(_ provider: NSItemProvider, type: String) {
        provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, _ in
            guard let url else { DispatchQueue.main.async { self?.message.text = "קריאת הקובץ נכשלה." }; return }
            do {
                let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard size > 0, size <= 10 * 1024 * 1024 else { throw NSError(domain: "size", code: 1) }
                let data = try Data(contentsOf: url)
                let name = provider.suggestedName ?? url.lastPathComponent
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                DispatchQueue.main.async {
                    self?.payload = ["name": name, "type": mime, "data": data.base64EncodedString()]
                    self?.message.text = name + "\nבחרו פעולה. התוכן ימתין באפליקציה להשלמת הפרטים."
                    self?.addAction("הדפסה", destination: "print")
                    if ["application/pdf", "image/png", "image/jpeg", "image/webp"].contains(mime) {
                        self?.addAction("שיוך לתלמיד", destination: "student")
                    }
                }
            } catch { DispatchQueue.main.async { self?.message.text = "לא ניתן לקרוא את הקובץ. ניתן לשתף קובץ אחד עד 10MB." } }
        }
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
            message.text = "נשמר. פתחו את CRM CY כדי לבחור תלמיד או תבנית ולאשר את הפעולה. שום קובץ עדיין לא נשלח להדפסה או הועלה למערכת."
            let done = UIButton(type: .system); done.setTitle("סיום", for: .normal)
            done.addAction(UIAction { [weak self] _ in self?.extensionContext?.completeRequest(returningItems: nil) }, for: .touchUpInside)
            actions.addArrangedSubview(done)
        } catch { message.text = "שמירת השיתוף נכשלה. נסו שוב." }
    }
}
