import { env } from 'vscode';

export function vscodeShell(): string {
    return env.shell;
}
