import Foundation

@main
struct NavigationPolicyChecks {
    static func main() {
        let base = URL(string: "https://crm.example")!
        func route(_ url: String, main: Bool? = true) -> CRMNavigationPolicy.Destination {
            CRMNavigationPolicy.destination(url: URL(string: url)!, baseURL: base, isMainFrame: main, sourceHost: "crm.example")
        }
        precondition(route("https://crm.example/sign-in") == .authenticate)
        precondition(route("https://crm.example/mobile/finish") == .embedded)
        precondition(route("https://live-urchin-40.clerk.accounts.dev/sync", main: false) == .embedded)
        precondition(route("https://live-urchin-40.clerk.accounts.dev/sign-in") == .authenticate)
        precondition(route("about:blank", main: false) == .embedded)
        precondition(route("https://accounts.google.com/o/oauth2/auth") == .authenticate)
        precondition(route("https://evilaccounts.dev/") == .external)
        precondition(route("https://wa.me/123") == .external)
        precondition(route("javascript:alert(1)") == .blocked)
        precondition(CRMNavigationPolicy.isExpectedCancellation(NSError(domain: "WebKitErrorDomain", code: 102)))
        precondition(CRMNavigationPolicy.isExpectedCancellation(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
        precondition(!CRMNavigationPolicy.isExpectedCancellation(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)))
        print("12 native authentication navigation checks passed")
    }
}
