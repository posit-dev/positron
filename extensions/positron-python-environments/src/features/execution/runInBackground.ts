import { PythonBackgroundRunOptions, PythonEnvironment, PythonProcess } from '../../api';
import { spawnProcess } from '../../common/childProcess.apis';
import { traceError, traceInfo, traceWarn } from '../../common/logging';
import { quoteStringIfNecessary } from './execUtils';

export async function runInBackground(
    environment: PythonEnvironment,
    options: PythonBackgroundRunOptions,
): Promise<PythonProcess> {
    let executable = environment.execInfo?.activatedRun?.executable ?? environment.execInfo?.run.executable;
    if (!executable) {
        traceWarn('No Python executable found in environment; falling back to "python".');
        executable = 'python';
    }

    // Don't quote the executable path for spawn - it handles spaces correctly on its own
    // Remove any existing quotes that might cause issues
    // see https://github.com/nodejs/node/issues/7367 for more details on cp.spawn and quoting
    if (executable.startsWith('"') && executable.endsWith('"')) {
        executable = executable.substring(1, executable.length - 1);
    }

    const args = environment.execInfo?.activatedRun?.args ?? environment.execInfo?.run.args ?? [];
    const allArgs = [...args, ...options.args];

    // Log the command for debugging
    traceInfo(`Running in background: "${executable}" ${allArgs.join(' ')}`);

    // Check if the file exists before trying to spawn it
    try {
        const fs = require('fs');
        if (!fs.existsSync(executable)) {
            traceError(
                `Python executable does not exist: ${executable}. Attempting to quote the path as a workaround...`,
            );
            executable = quoteStringIfNecessary(executable);
        }
    } catch (err) {
        traceWarn(`Error checking if executable exists: ${err instanceof Error ? err.message : String(err)}`);
    }

    const proc = spawnProcess(executable, allArgs, {
        stdio: 'pipe',
        cwd: options.cwd,
        env: options.env,
    });

    return {
        pid: proc.pid,
        stdin: proc.stdin,
        stdout: proc.stdout,
        stderr: proc.stderr,
        kill: () => {
            if (!proc.killed) {
                proc.kill();
            }
        },
        onExit: (listener: (code: number | null, signal: NodeJS.Signals | null, error?: Error | null) => void) => {
            proc.on('exit', (code, signal) => {
                if (code && code !== 0) {
                    traceError(`Process exited with error code: ${code}, signal: ${signal}`);
                }
                listener(code, signal, null);
            });
            proc.on('error', (error) => {
                traceError(`Process error: ${error?.message || error}${error?.stack ? '\n' + error.stack : ''}`);
                listener(null, null, error);
            });
        },
    };
}
