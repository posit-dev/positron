import { Terminal, TerminalShellExecution } from 'vscode';
import { PythonEnvironment, PythonTerminalExecutionOptions } from '../../api';
import { createDeferred } from '../../common/utils/deferred';
import { onDidEndTerminalShellExecution } from '../../common/window.apis';
import { ShellConstants } from '../common/shellConstants';
import { identifyTerminalShell } from '../common/shellDetector';
import { quoteArgs } from '../execution/execUtils';
import { normalizeShellPath } from './shells/common/shellUtils';

export async function runInTerminal(
    environment: PythonEnvironment,
    terminal: Terminal,
    options: PythonTerminalExecutionOptions,
): Promise<void> {
    if (options.show) {
        terminal.show();
    }

    let executable = environment.execInfo?.activatedRun?.executable ?? environment.execInfo?.run.executable ?? 'python';
    const args = environment.execInfo?.activatedRun?.args ?? environment.execInfo?.run.args ?? [];
    const allArgs = [...args, ...(options.args ?? [])];
    const shellType = identifyTerminalShell(terminal);

    // Normalize executable path for Git Bash on Windows
    if (shellType === ShellConstants.GITBASH) {
        executable = normalizeShellPath(executable, shellType);
    }
    if (terminal.shellIntegration) {
        let execution: TerminalShellExecution | undefined;
        const deferred = createDeferred<void>();
        const disposable = onDidEndTerminalShellExecution((e) => {
            if (e.execution === execution) {
                disposable.dispose();
                deferred.resolve();
            }
        });

        const shouldSurroundWithQuotes =
            executable.includes(' ') && !executable.startsWith('"') && !executable.endsWith('"');
        // Handle case where executable contains white-spaces.
        if (shouldSurroundWithQuotes) {
            executable = `"${executable}"`;
        }

        if (shellType === ShellConstants.PWSH && !executable.startsWith('&')) {
            // PowerShell requires commands to be prefixed with '&' to run them.
            executable = `& ${executable}`;
        }
        execution = terminal.shellIntegration.executeCommand(executable, allArgs);
        await deferred.promise;
    } else {
        let text = quoteArgs([executable, ...allArgs]).join(' ');
        if (shellType === ShellConstants.PWSH && !text.startsWith('&')) {
            // PowerShell requires commands to be prefixed with '&' to run them.
            text = `& ${text}`;
        }
        terminal.sendText(`${text}\n`);
    }
}
