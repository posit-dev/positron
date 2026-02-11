import * as cp from 'child_process';

/**
 * Spawns a new process using the specified command and arguments.
 * This function abstracts cp.spawn to make it easier to mock in tests.
 *
 * When stdio: 'pipe' is used, returns ChildProcessWithoutNullStreams.
 * Otherwise returns the standard ChildProcess.
 */

// Overload for stdio: 'pipe' - guarantees non-null streams
export function spawnProcess(
    command: string,
    args: string[],
    options: cp.SpawnOptions & { stdio: 'pipe' },
): cp.ChildProcessWithoutNullStreams;

// Overload for general case
export function spawnProcess(command: string, args: string[], options?: cp.SpawnOptions): cp.ChildProcess;

// Implementation - delegates to cp.spawn to preserve its typing magic
export function spawnProcess(
    command: string,
    args: string[],
    options?: cp.SpawnOptions,
): cp.ChildProcess | cp.ChildProcessWithoutNullStreams {
    return cp.spawn(command, args, options ?? {});
}
