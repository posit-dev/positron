import * as stackTrace from 'stack-trace';
import { commands, LogOutputChannel } from 'vscode';
import { Common } from '../localize';
import { showErrorMessage, showWarningMessage } from '../window.apis';

export function parseStack(ex: Error) {
    if (ex.stack && Array.isArray(ex.stack)) {
        const concatenated = { ...ex, stack: ex.stack.join('\n') };
        return stackTrace.parse.call(stackTrace, concatenated);
    }
    return stackTrace.parse.call(stackTrace, ex);
}

export async function showErrorMessageWithLogs(message: string, log?: LogOutputChannel) {
    const result = await showErrorMessage(message, Common.viewLogs);
    if (result === Common.viewLogs) {
        if (log) {
            log.show();
        } else {
            commands.executeCommand('python-envs.viewLogs');
        }
    }
}

export async function showWarningMessageWithLogs(message: string, log?: LogOutputChannel) {
    const result = await showWarningMessage(message, Common.viewLogs);
    if (result === Common.viewLogs) {
        if (log) {
            log.show();
        } else {
            commands.executeCommand('python-envs.viewLogs');
        }
    }
}
