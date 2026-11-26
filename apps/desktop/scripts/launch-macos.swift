import AppKit
import Foundation

// NSRunningApplication sends the same native termination request as Dock Quit,
// targeting only the isolated PID owned by the diagnostic harness.
if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--quit" {
    guard let pid = Int32(CommandLine.arguments[2]),
          let app = NSRunningApplication(processIdentifier: pid), app.terminate() else {
        fputs("Could not request native application termination\n", stderr)
        exit(1)
    }
    exit(0)
}

// LaunchServices gives the app its own responsibility identity, allowing its
// launchd-owned WebKit helpers to be attributed without counting other apps.
let configuration = NSWorkspace.OpenConfiguration()
configuration.environment = ProcessInfo.processInfo.environment
configuration.createsNewApplicationInstance = true
let background = ProcessInfo.processInfo.environment["LEON_DESKTOP_BACKGROUND"] != "0"
configuration.activates = !background
configuration.hides = background
configuration.hidesOthers = false
let applicationURL = URL(fileURLWithPath: CommandLine.arguments[1])

NSWorkspace.shared.openApplication(at: applicationURL, configuration: configuration) { app, error in
    guard let app else {
        fputs("Could not open the desktop bundle: \(String(describing: error))\n", stderr)
        exit(1)
    }
    print(app.processIdentifier)
    fflush(stdout)
    DispatchQueue.main.async {
        Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            if app.isTerminated {
                exit(0)
            }
        }
    }
}
RunLoop.main.run()
