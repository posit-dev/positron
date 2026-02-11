import * as os from 'os';
import { Terminal } from 'vscode';
import { vscodeShell } from '../../common/vscodeEnv.apis';
import { getConfiguration } from '../../common/workspace.apis';
import { isWindows } from '../../common/utils/platformUtils';
import { ShellConstants } from './shellConstants';

/*
When identifying the shell use the following algorithm:
* 1. Identify shell based on the name of the terminal (if there is one already opened and used).
* 2. Identify shell based on the api provided by VSC.
* 2. Identify shell based on the settings in VSC.
* 3. Identify shell based on users environment variables.
* 4. Use default shells (bash for mac and linux, cmd for windows).
*/

// Types of shells can be found here:
// 1. https://wiki.ubuntu.com/ChangingShells
const IS_GITBASH = /(gitbash$|git.bin.bash$|git-bash$)/i;
const IS_BASH = /(bash$)/i;
const IS_WSL = /(wsl$)/i;
const IS_ZSH = /(zsh$)/i;
const IS_KSH = /(ksh$)/i;
const IS_COMMAND = /(cmd$)/i;
const IS_POWERSHELL = /(powershell$|pwsh$)/i;
const IS_FISH = /(fish$)/i;
const IS_CSHELL = /(csh$)/i;
const IS_TCSHELL = /(tcsh$)/i;
const IS_NUSHELL = /(nu$)/i;
const IS_XONSH = /(xonsh$)/i;

const detectableShells = new Map<string, RegExp>([
    [ShellConstants.PWSH, IS_POWERSHELL],
    [ShellConstants.GITBASH, IS_GITBASH],
    [ShellConstants.BASH, IS_BASH],
    [ShellConstants.WSL, IS_WSL],
    [ShellConstants.ZSH, IS_ZSH],
    [ShellConstants.KSH, IS_KSH],
    [ShellConstants.CMD, IS_COMMAND],
    [ShellConstants.FISH, IS_FISH],
    [ShellConstants.TCSH, IS_TCSHELL],
    [ShellConstants.CSH, IS_CSHELL],
    [ShellConstants.NU, IS_NUSHELL],
    [ShellConstants.XONSH, IS_XONSH],
]);

function identifyShellFromShellPath(shellPath: string): string {
    // Remove .exe extension so shells can be more consistently detected
    // on Windows (including Cygwin).
    const basePath = shellPath.replace(/\.exe$/i, '');

    const shell = Array.from(detectableShells.keys()).reduce((matchedShell, shellToDetect) => {
        if (matchedShell === 'unknown') {
            const pat = detectableShells.get(shellToDetect);
            if (pat && pat.test(basePath)) {
                return shellToDetect;
            }
        }
        return matchedShell;
    }, 'unknown');

    return shell;
}

function identifyShellFromTerminalName(terminal: Terminal): string {
    if (terminal.name === ShellConstants.SH) {
        // Specifically checking this because other shells have `sh` at the end of their name
        // We can match and return bash for this case
        return ShellConstants.BASH;
    }
    return identifyShellFromShellPath(terminal.name);
}

function identifyPlatformDefaultShell(): string {
    if (isWindows()) {
        return identifyShellFromShellPath(getTerminalDefaultShellWindows());
    }

    const shellPath = process.env.SHELL && process.env.SHELL !== '/bin/false' ? process.env.SHELL : '/bin/bash';
    return identifyShellFromShellPath(shellPath);
}

function getTerminalDefaultShellWindows(): string {
    const isAtLeastWindows10 = parseFloat(os.release()) >= 10;
    const syspath = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432') ? 'Sysnative' : 'System32';
    const windir = process.env.windir ?? 'C:\\Windows';
    const powerShellPath = `${windir}\\${syspath}\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return isAtLeastWindows10 ? powerShellPath : process.env.comspec || 'cmd.exe';
}

function identifyShellFromVSC(terminal: Terminal): string {
    const shellPath =
        terminal?.creationOptions && 'shellPath' in terminal.creationOptions && terminal.creationOptions.shellPath
            ? terminal.creationOptions.shellPath
            : vscodeShell();

    return shellPath ? identifyShellFromShellPath(shellPath) : 'unknown';
}

function identifyShellFromSettings(): string {
    const shellConfig = getConfiguration('terminal.integrated.shell');
    let shellPath: string | undefined;
    switch (process.platform) {
        case 'win32': {
            shellPath = shellConfig.get<string>('windows');
            break;
        }
        case 'darwin': {
            shellPath = shellConfig.get<string>('osx');
            break;
        }
        case 'freebsd':
        case 'openbsd':
        case 'linux': {
            shellPath = shellConfig.get<string>('linux');
            break;
        }
        default: {
            shellPath = undefined;
        }
    }
    return shellPath ? identifyShellFromShellPath(shellPath) : 'unknown';
}

function fromShellTypeApi(terminal: Terminal): string {
    try {
        const known = [
            ShellConstants.BASH,
            ShellConstants.CMD,
            ShellConstants.CSH,
            ShellConstants.FISH,
            ShellConstants.GITBASH,
            'julia',
            ShellConstants.KSH,
            'node',
            ShellConstants.NU,
            ShellConstants.PWSH,
            'python',
            ShellConstants.SH,
            'wsl',
            ShellConstants.ZSH,
        ];
        if (terminal.state.shell && known.includes(terminal.state.shell.toLowerCase())) {
            return terminal.state.shell.toLowerCase();
        }
    } catch {
        // If the API is not available, return unknown
    }
    return 'unknown';
}

export function identifyTerminalShell(terminal: Terminal): string {
    let shellType = fromShellTypeApi(terminal);

    if (shellType === 'unknown') {
        shellType = identifyShellFromVSC(terminal);
    }

    if (shellType === 'unknown') {
        shellType = identifyShellFromTerminalName(terminal);
    }

    if (shellType === 'unknown') {
        shellType = identifyShellFromSettings();
    }

    if (shellType === 'unknown') {
        shellType = identifyPlatformDefaultShell();
    }

    return shellType;
}
