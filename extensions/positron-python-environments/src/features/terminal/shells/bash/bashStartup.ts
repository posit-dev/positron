import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import which from 'which';
import { traceError, traceInfo, traceVerbose } from '../../../../common/logging';
import { ShellConstants } from '../../../common/shellConstants';
import { hasStartupCode, insertStartupCode, removeStartupCode } from '../common/editUtils';
import { ShellScriptEditState, ShellSetupState, ShellStartupScriptProvider } from '../startupProvider';
import { BASH_ENV_KEY, BASH_OLD_ENV_KEY, BASH_SCRIPT_VERSION, ZSH_ENV_KEY, ZSH_OLD_ENV_KEY } from './bashConstants';

async function isBashLikeInstalled(): Promise<boolean> {
    const result = await Promise.all([which('bash', { nothrow: true }), which('sh', { nothrow: true })]);
    return result.some((r) => r !== null);
}

async function isZshInstalled(): Promise<boolean> {
    const result = await which('zsh', { nothrow: true });
    return result !== null;
}

async function isGitBashInstalled(): Promise<boolean> {
    const gitPath = await which('git', { nothrow: true });
    if (gitPath) {
        const gitBashPath = path.join(path.dirname(path.dirname(gitPath)), 'bin', 'bash.exe');
        return await fs.pathExists(gitBashPath);
    }
    return false;
}

async function getBashProfiles(): Promise<string> {
    const homeDir = os.homedir();
    const profile: string = path.join(homeDir, '.bashrc');

    return profile;
}

async function getZshProfiles(): Promise<string> {
    const zdotdir = process.env.ZDOTDIR;
    const baseDir = zdotdir || os.homedir();
    const profile: string = path.join(baseDir, '.zshrc');

    return profile;
}

const regionStart = '# >>> vscode python';
const regionEnd = '# <<< vscode python';

function getActivationContent(key: string): string {
    const lineSep = '\n';
    return [
        `# version: ${BASH_SCRIPT_VERSION}`,
        `if [ -z "$VSCODE_PYTHON_AUTOACTIVATE_GUARD" ]; then`,
        `    export VSCODE_PYTHON_AUTOACTIVATE_GUARD=1`,
        `    if [ -n "$${key}" ] && [ "$TERM_PROGRAM" = "vscode" ]; then`,
        `        eval "$${key}" || true`,
        `    fi`,
        `fi`,
    ].join(lineSep);
}

async function isStartupSetup(profile: string, key: string): Promise<ShellSetupState> {
    if (await fs.pathExists(profile)) {
        const content = await fs.readFile(profile, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [key])) {
            return ShellSetupState.Setup;
        }
    }
    return ShellSetupState.NotSetup;
}
async function setupStartup(profile: string, key: string, name: string): Promise<boolean> {
    const activationContent = getActivationContent(key);
    try {
        if (await fs.pathExists(profile)) {
            const content = await fs.readFile(profile, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [key])) {
                traceInfo(`SHELL: ${name} profile already contains activation code at: ${profile}`);
            } else {
                await fs.writeFile(profile, insertStartupCode(content, regionStart, regionEnd, activationContent));
                traceInfo(`SHELL: Updated existing ${name} profile at: ${profile}\n${activationContent}`);
            }
        } else {
            await fs.mkdirp(path.dirname(profile));
            await fs.writeFile(profile, insertStartupCode('', regionStart, regionEnd, activationContent));
            traceInfo(`SHELL: Created new ${name} profile at: ${profile}\n${activationContent}`);
        }

        return true;
    } catch (err) {
        traceError(`SHELL: Failed to setup startup for profile at: ${profile}`, err);
        return false;
    }
}

async function removeStartup(profile: string, key: string): Promise<boolean> {
    if (!(await fs.pathExists(profile))) {
        return true;
    }

    try {
        const content = await fs.readFile(profile, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [key])) {
            await fs.writeFile(profile, removeStartupCode(content, regionStart, regionEnd));
            traceInfo(`SHELL: Removed activation from profile at: ${profile}, for key: ${key}`);
        } else {
            traceVerbose(`Profile at ${profile} does not contain activation code, for key: ${key}`);
        }
        return true;
    } catch (err) {
        traceVerbose(`Failed to remove ${profile} startup, for key: ${key}`, err);
        return false;
    }
}

export class BashStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'bash';
    public readonly shellType: string = ShellConstants.BASH;

    private async checkShellInstalled(): Promise<boolean> {
        const found = await isBashLikeInstalled();
        if (!found) {
            traceInfo(
                '`bash` or `sh` was not found on the system',
                'If it is installed make sure it is available on `PATH`',
            );
        }
        return found;
    }

    async isSetup(): Promise<ShellSetupState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellSetupState.NotInstalled;
        }

        try {
            const bashProfile = await getBashProfiles();
            return await isStartupSetup(bashProfile, BASH_ENV_KEY);
        } catch (err) {
            traceError('Failed to check bash startup scripts', err);
            return ShellSetupState.NotSetup;
        }
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const bashProfiles = await getBashProfiles();
            const result = await setupStartup(bashProfiles, BASH_ENV_KEY, this.name);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to setup bash startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const bashProfile = await getBashProfiles();
            // Remove old environment variable if it exists
            await removeStartup(bashProfile, BASH_OLD_ENV_KEY);
            const result = await removeStartup(bashProfile, BASH_ENV_KEY);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to teardown bash startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    clearCache(): Promise<void> {
        return Promise.resolve();
    }
}

export class ZshStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'zsh';
    public readonly shellType: string = ShellConstants.ZSH;

    private async checkShellInstalled(): Promise<boolean> {
        const found = await isZshInstalled();
        if (!found) {
            traceInfo('`zsh` was not found on the system', 'If it is installed make sure it is available on `PATH`');
        }
        return found;
    }

    async isSetup(): Promise<ShellSetupState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellSetupState.NotInstalled;
        }

        try {
            const zshProfiles = await getZshProfiles();
            return await isStartupSetup(zshProfiles, ZSH_ENV_KEY);
        } catch (err) {
            traceError('Failed to check zsh startup scripts', err);
            return ShellSetupState.NotSetup;
        }
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }
        try {
            const zshProfiles = await getZshProfiles();
            const result = await setupStartup(zshProfiles, ZSH_ENV_KEY, this.name);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to setup zsh startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }
        try {
            const zshProfiles = await getZshProfiles();
            await removeStartup(zshProfiles, ZSH_OLD_ENV_KEY);
            const result = await removeStartup(zshProfiles, ZSH_ENV_KEY);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to teardown zsh startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }
    clearCache(): Promise<void> {
        return Promise.resolve();
    }
}

export class GitBashStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'Git bash';
    public readonly shellType: string = ShellConstants.GITBASH;

    private async checkShellInstalled(): Promise<boolean> {
        const found = await isGitBashInstalled();
        if (!found) {
            traceInfo('Git Bash was not found on the system', 'If it is installed make sure it is available on `PATH`');
        }
        return found;
    }

    async isSetup(): Promise<ShellSetupState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellSetupState.NotInstalled;
        }
        try {
            const bashProfiles = await getBashProfiles();
            return await isStartupSetup(bashProfiles, BASH_ENV_KEY);
        } catch (err) {
            traceError('Failed to check git bash startup scripts', err);
            return ShellSetupState.NotSetup;
        }
    }
    async setupScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const bashProfiles = await getBashProfiles();
            const result = await setupStartup(bashProfiles, BASH_ENV_KEY, this.name);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to setup git bash startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }
    async teardownScripts(): Promise<ShellScriptEditState> {
        const found = await this.checkShellInstalled();
        if (!found) {
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const bashProfiles = await getBashProfiles();
            await removeStartup(bashProfiles, BASH_OLD_ENV_KEY);
            const result = await removeStartup(bashProfiles, BASH_ENV_KEY);
            return result ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to teardown git bash startup scripts', err);
            return ShellScriptEditState.NotEdited;
        }
    }
    clearCache(): Promise<void> {
        return Promise.resolve();
    }
}
