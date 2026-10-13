import os
import signal
import subprocess


def terminate_process_tree(pid: int, signal_name: str = 'SIGTERM') -> None:
    """Signal a process and its current descendants, tolerating processes already gone.

    Windows uses taskkill's forced tree termination for either signal.
    """
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        raise ValueError('Process ID must be a positive integer.')

    selected_signal = signal.Signals[signal_name]

    if os.name == 'nt':
        result = subprocess.run(
            ['taskkill', '/pid', str(pid), '/T', '/F'],
            capture_output=True,
            text=True,
        )
        if result.returncode not in (0, 128):
            raise RuntimeError(result.stderr or result.stdout)
        return

    result = subprocess.run(
        ['ps', '-A', '-o', 'pid=', '-o', 'ppid='],
        capture_output=True,
        text=True,
        check=True,
    )
    children = {}
    for line in result.stdout.splitlines():
        child, parent = map(int, line.split())
        children.setdefault(parent, []).append(child)

    descendants = [pid]
    for parent in descendants:
        descendants.extend(children.get(parent, []))

    # Collect the tree first so parent exit cannot hide its descendants.
    for target in reversed(descendants):
        try:
            os.kill(target, selected_signal)
        except ProcessLookupError:
            pass
