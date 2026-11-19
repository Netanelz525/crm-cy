import Foundation

final class NativeShareQueue: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    static let shared = NativeShareQueue()
    static let group = "group.il.co.yeshivatcy.crm"
    var backgroundCompletion: (() -> Void)?
    private var responses: [Int: Data] = [:]
    private var active = Set<String>()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: "il.co.yeshivatcy.crm.native-share")
        config.sharedContainerIdentifier = Self.group
        config.waitsForConnectivity = true
        config.isDiscretionary = false
        config.timeoutIntervalForResource = 7 * 86400
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()
    static var root: URL? { FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) }
    static var folder: URL? { root?.appendingPathComponent("NativeShareQueue", isDirectory: true) }
    static func configuration() -> [String: Any]? {
        guard let root, let data = try? Data(contentsOf: root.appendingPathComponent("ShareSession.json")) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    private func manifest(_ id: String) -> URL? { Self.folder?.appendingPathComponent(id + ".json") }
    private func read(_ id: String) -> [String: Any]? {
        guard let url = manifest(id), let data = try? Data(contentsOf: url) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    private func write(_ job: [String: Any], id: String) throws {
        guard let url = manifest(id) else { throw NSError(domain: "SharedContainer", code: 1) }
        try JSONSerialization.data(withJSONObject: job).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func enqueue(payload: [String: String], destination: String, templateId: String, plan: String, copies: Int, expectedUserId: String) throws {
        guard let folder = Self.folder, let config = Self.configuration(),
              let user = config["userId"] as? String, user == expectedUserId, let encoded = payload["data"],
              let data = Data(base64Encoded: encoded) else { throw NSError(domain: "ShareConfiguration", code: 1) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let id = UUID().uuidString
        var job: [String: Any] = [
            "id": id, "userId": user, "name": payload["name"] ?? "shared-file",
            "type": payload["type"] ?? "application/octet-stream", "destination": destination,
            "templateId": templateId, "printPlan": plan, "copies": copies,
            "size": data.count, "parts": Int(ceil(Double(encoded.count) / 640000)),
            "nextPart": 0, "state": "pending"
        ]
        job["createdAt"] = Date().timeIntervalSince1970
        try data.write(to: folder.appendingPathComponent(id + ".bin"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try write(job, id: id)
        start(id)
    }
    func resume() {
        _ = session
        session.getAllTasks { tasks in
            DispatchQueue.main.async {
                self.active.formUnion(tasks.compactMap { $0.taskDescription })
                guard let folder = Self.folder, let urls = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
                for url in urls where url.pathExtension == "json" {
                    let id = url.deletingPathExtension().lastPathComponent
                    if let state = self.read(id)?["state"] as? String, ["pending", "authentication"].contains(state) { self.start(id) }
                }
            }
        }
    }
    private func start(_ id: String) {
        guard !active.contains(id), var job = read(id), let folder = Self.folder,
              let config = Self.configuration(), config["userId"] as? String == job["userId"] as? String,
              let token = config["token"] as? String,
              let bytes = try? Data(contentsOf: folder.appendingPathComponent(id + ".bin")) else { return }
        let part = job["nextPart"] as? Int ?? 0
        let count = job["parts"] as? Int ?? 0
        var body = job
        body["action"] = part < count ? "chunk" : "finish"
        if part < count {
            let encoded = bytes.base64EncodedString()
            let begin = encoded.index(encoded.startIndex, offsetBy: part * 640000)
            let end = encoded.index(begin, offsetBy: min(640000, encoded.distance(from: begin, to: encoded.endIndex)))
            body["part"] = part
            body["data"] = String(encoded[begin..<end])
        }
        do {
            let upload = folder.appendingPathComponent(id + ".request")
            try JSONSerialization.data(withJSONObject: body).write(to: upload, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            var request = URLRequest(url: URL(string: "https://crm-cy-nu.vercel.app/api/mobile/native-share")!)
            request.httpMethod = "POST"
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let task = session.uploadTask(with: request, fromFile: upload)
            task.taskDescription = id
            active.insert(id)
            job["state"] = "pending"
            try write(job, id: id)
            task.resume()
        } catch { }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        responses[dataTask.taskIdentifier, default: Data()].append(data)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription, var job = read(id) else { return }
        active.remove(id)
        let data = responses.removeValue(forKey: task.taskIdentifier) ?? Data()
        let result = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil && status == 200 {
            if result["completed"] as? Bool == true {
                for suffix in [".json", ".bin", ".request"] {
                    if let url = Self.folder?.appendingPathComponent(id + suffix) { try? FileManager.default.removeItem(at: url) }
                }
                return
            }
            job["nextPart"] = (job["nextPart"] as? Int ?? 0) + 1
            try? write(job, id: id)
            start(id)
        } else {
            job["state"] = status == 401 ? "authentication" : (status >= 400 && status < 500 ? "review" : "pending")
            job["error"] = result["error"] as? String ?? "ממתין לחיבור לרשת"
            try? write(job, id: id)
        }
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        backgroundCompletion?()
        backgroundCompletion = nil
    }
}

import SwiftUI

struct NativeShareForm: View {
    let payload: [String: String]
    let initialDestination: String
    let onDone: () -> Void
    @State private var destination = ""
    @State private var plan = ""
    @State private var copies = 1
    @State private var query = ""
    @State private var templateId = ""
    @State private var values: [String: String] = [:]
    @State private var textField = ""
    @State private var error = ""
    @State private var saved = false
    private let config = NativeShareQueue.configuration() ?? [:]
    private var plans: [[String: String]] { config["plans"] as? [[String: String]] ?? [] }
    private var templates: [[String: Any]] { config["templates"] as? [[String: Any]] ?? [] }
    private var fields: [[String: Any]] {
        templates.first { $0["id"] as? String == templateId }?["fields"] as? [[String: Any]] ?? []
    }
    var body: some View {
        NavigationStack {
            Form {
                Section { Text(payload["name"] ?? "קובץ משותף") }
                if saved {
                    Section {
                        Label("נשמר בתור השליחה באייפון", systemImage: "checkmark.circle.fill")
                        Text("הקובץ יישלח כשהרשת זמינה. אפשר לעקוב אחריו ב״שליחות ממתינות״ באפליקציה.")
                        Button("סיום", action: onDone)
                    }
                } else if config["userId"] == nil {
                    Text("פתחו את CRM CY פעם אחת כדי להוריד את אפשרויות השיתוף למכשיר.")
                } else if config["canPrint"] as? Bool != true {
                    Text("לחשבון הזה אין הרשאת הדפסה. ניתן לשייך קבצים לתלמיד מתוך אפשרות השיוך.")
                } else {
                    Section("פעולה") {
                        Picker("מה לעשות עם הקובץ?", selection: $destination) {
                            if config["canPrint"] as? Bool == true { Text("הדפסה").tag("print") }
                            if !templates.isEmpty { Text("טקסט לתבנית").tag("template") }
                        }
                    }
                    if destination == "print" || destination == "template" {
                        Section("אפשרויות הדפסה") {
                            Picker("תוכנית הדפסה", selection: $plan) {
                                ForEach(plans, id: \.self) { item in Text(item["name"] ?? "").tag(item["id"] ?? "") }
                            }
                            Stepper("עותקים \(copies)", value: $copies, in: 1...99)
                            if let balance = config["creditBalance"] as? Int { Text("יתרה בעדכון האחרון \(balance) דפים") }
                        }
                    }
                    if destination == "template" {
                        Section("תבנית") {
                            Picker("תבנית שמורה", selection: $templateId) {
                                ForEach(templates.indices, id: \.self) { index in
                                    Text(templates[index]["name"] as? String ?? "").tag(templates[index]["id"] as? String ?? "")
                                }
                            }.onChange(of: templateId) { _, _ in values = [:]; textField = "" }
                            Text(payload["text"] ?? "").lineLimit(4)
                            Picker("הכנסת הטקסט לשדה", selection: $textField) {
                                Text("בחרו שדה").tag("")
                                ForEach(fields.indices, id: \.self) { index in
                                    Text(fields[index]["label"] as? String ?? "").tag(fields[index]["key"] as? String ?? "")
                                }
                            }
                            Button("הכנס טקסט לשדה") {
                                if !textField.isEmpty { values[textField] = payload["text"] ?? "" }
                            }
                        }
                        Section("שדות התבנית") {
                            ForEach(fields.indices, id: \.self) { index in
                                let key = fields[index]["key"] as? String ?? ""
                                TextField(fields[index]["label"] as? String ?? "", text: Binding(
                                    get: { values[key] ?? "" }, set: { values[key] = $0 }
                                ), axis: .vertical)
                            }
                        }
                    }
                    if !error.isEmpty { Text(error).foregroundStyle(.red) }
                    Button("אישור ושמירה לשליחה להדפסה") {
                        do {
                            var content = payload
                            if destination == "template" {
                                for field in fields {
                                    let key = field["key"] as? String ?? ""
                                    let value = values[key] ?? ""
                                    if field["required"] as? Bool == true && value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                        error = "יש למלא את שדות החובה בתבנית."
                                        return
                                    }
                                    if let limit = field["maxLength"] as? Int, limit > 0, value.count > limit {
                                        error = "אחד השדות ארוך מהמותר בתבנית."
                                        return
                                    }
                                }
                                let data = try JSONSerialization.data(withJSONObject: values)
                                content = ["name": "template.json", "type": "application/json", "data": data.base64EncodedString()]
                            }
                            try NativeShareQueue.shared.enqueue(payload: content, destination: destination,
                                templateId: templateId, plan: plan, copies: copies, expectedUserId: config["userId"] as? String ?? "")
                            saved = true
                        } catch { self.error = "השמירה במכשיר נכשלה. נסו שוב." }
                    }.disabled(destination.isEmpty || (destination == "template" && templateId.isEmpty))

                }
            }
            .navigationTitle("שיתוף ל־CRM CY")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("סגירה", action: onDone) } }
            .environment(\.layoutDirection, .rightToLeft)
            .onAppear {
                destination = config["canPrint"] as? Bool == true ? initialDestination : ""
                plan = plans.first?["id"] ?? ""
                templateId = templates.first?["id"] as? String ?? ""
            }
        }
    }
}

struct NativeSharePendingView: View {
    @State private var jobs: [[String: Any]] = []
    private func refresh() {
        guard let folder = NativeShareQueue.folder,
              let urls = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return }
        let userId = NativeShareQueue.configuration()?["userId"] as? String
        jobs = urls.filter { $0.pathExtension == "json" }.compactMap {
            guard let data = try? Data(contentsOf: $0) else { return nil }
            guard let job = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                  job["userId"] as? String == userId else { return nil }
            return job
        }
    }
    var body: some View {
        List {
            if jobs.isEmpty { Text("אין שליחות ממתינות") }
            ForEach(jobs.indices, id: \.self) { index in
                VStack(alignment: .leading, spacing: 8) {
                    Text(jobs[index]["name"] as? String ?? "קובץ")
                    Text(jobs[index]["state"] as? String == "authentication" ? "יש לחדש התחברות באפליקציה" :
                         jobs[index]["error"] as? String ?? "ממתין לרשת או בשליחה")
                        .font(.caption)
                }
            }
            Button("רענון וניסיון לשליחה") { NativeShareQueue.shared.resume(); refresh() }
        }.navigationTitle("שליחות ממתינות").onAppear(perform: refresh)
    }
}
