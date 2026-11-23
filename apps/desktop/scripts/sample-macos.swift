import Foundation
import Darwin

// Read native app/helper counters without adding a Node FFI dependency.
let library = dlopen("/usr/lib/libSystem.B.dylib", RTLD_LAZY)!
typealias ListPids = @convention(c) (UnsafeMutableRawPointer?, Int32) -> Int32
typealias ResponsiblePid = @convention(c) (Int32) -> Int32
typealias ReadUsage = @convention(c) (Int32, Int32, UnsafeMutableRawPointer) -> Int32
let listPids = unsafeBitCast(dlsym(library, "proc_listallpids")!, to: ListPids.self)
let responsiblePid = unsafeBitCast(dlsym(library, "responsibility_get_pid_responsible_for_pid")!, to: ResponsiblePid.self)
let readUsage = unsafeBitCast(dlsym(library, "proc_pid_rusage")!, to: ReadUsage.self)
let root = Int32(CommandLine.arguments[1])!
var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
var pids = [Int32](repeating: 0, count: max(1, Int(listPids(nil, 0))) * 2)
let count = pids.withUnsafeMutableBytes { listPids($0.baseAddress, Int32($0.count)) }
var processes = [[String: Any]]()
var footprint: UInt64 = 0
for pid in pids.prefix(Int(count)) where pid == root || responsiblePid(pid) == root {
    var usage = rusage_info_v4()
    let status = withUnsafeMutablePointer(to: &usage) { readUsage(pid, 4, UnsafeMutableRawPointer($0)) }
    if status == 0 {
        footprint += usage.ri_phys_footprint
        let cpu = (usage.ri_user_time + usage.ri_system_time) * UInt64(timebase.numer) / UInt64(timebase.denom)
        processes.append(["pid": pid, "cpu_ns": cpu])
    }
}
guard processes.contains(where: { $0["pid"] as? Int32 == root }) else {
    fputs("Could not sample the native host\n", stderr)
    exit(1)
}
let result: [String: Any] = ["processes": processes, "physical_footprint_bytes": footprint]
let bytes = try JSONSerialization.data(withJSONObject: result)
FileHandle.standardOutput.write(bytes)
