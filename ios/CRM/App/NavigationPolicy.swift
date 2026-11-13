import Foundation

enum CRMNavigationPolicy {
    enum Destination: Equatable { case embedded, authenticate, external, blocked }

    static func destination(url: URL, baseURL: URL, isMainFrame: Bool?, sourceHost: String) -> Destination {
        // Clerk uses hidden HTTPS frames to synchronize the browser session.
        // A frame navigation must never launch another system sign-in session.
        if isMainFrame == false {
            return ["https", "about", "blob"].contains(url.scheme ?? "") ? .embedded : .blocked
        }
        if url.scheme == "blob", sourceHost == baseURL.host { return .embedded }
        if url.host == baseURL.host && url.scheme == baseURL.scheme {
            if url.path.hasPrefix("/sign-in") || url.path.hasPrefix("/sign-up") { return .authenticate }
            return .embedded
        }
        // Development Clerk sessions use a top-level browser handshake as well as frames.
        // It must finish in this same WebKit cookie store before ticket sign-in is ready.
        if url.scheme == "https", let host = url.host, host.hasSuffix(".accounts.dev"),
           ["/v1/client/handshake", "/v1/client/sync"].contains(url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/" )).isEmpty ? "/" : "/" + url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) {
            return .embedded
        }
        if let host = url.host,
           host == "accounts.google.com" || host.hasSuffix(".accounts.dev") {
            return .authenticate
        }
        return ["https", "http", "tel", "mailto"].contains(url.scheme ?? "") ? .external : .blocked
    }

    static func isExpectedCancellation(_ error: NSError) -> Bool {
        (error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled)
            || (error.domain == "WebKitErrorDomain" && error.code == 102)
    }
}
