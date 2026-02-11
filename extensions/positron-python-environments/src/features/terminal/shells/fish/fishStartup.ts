import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import which from 'which';

import { traceError, traceInfo, traceVerbose } from '../../../../common/logging';
import { ShellConstants } from '../../../common/shellConstants';
import { hasStartupCode, insertStartupCode, removeStartupCode } from '../common/editUtils';
import { ShellScriptEditState, ShellSetupState, ShellStartupScriptProvider } from '../startupProvider';
import { FISH_ENV_KEY, FISH_OLD_ENV_KEY, FISH_SCRIPT_VERSION } from './fishConstants';

async function isFishInstalled(): Promise<boolean> {
    try {
        await which('fish');
        return true;
    } catch {
        traceVerbose('Fish is not installed or not found in PATH');
        return false;
    }
}

async function getFishProfile(): Promise<string> {
    const homeDir = os.homedir();
    // Fish configuration is typically at ~/.config/fish/config.fish
    const profilePath = path.join(homeDir, '.config', 'fish', 'config.fish');
    traceInfo(`SHELL: fish profile found at: ${profilePath}`);
    return profilePath;
}

const regionStart = '# >>> vscode python';
const regionEnd = '# <<< vscode python';

function getActivationContent(key: string): string {
    const lineSep = '\n';
    return [
        `# version: ${FISH_SCRIPT_VERSION}`,
        `if not set -q VSCODE_PYTHON_AUTOACTIVATE_GUARD`,
        `    set -gx VSCODE_PYTHON_AUTOACTIVATE_GUARD 1`,
        `    if test "$TERM_PROGRAM" = "vscode"; and set -q ${key}`,
        `        eval $${key}`,
        `    end`,
        `end`,
    ].join(lineSep);
}

async function isStartupSetup(profilePath: string, key: string): Promise<boolean> {
    if (await fs.pathExists(profilePath)) {
        const content = await fs.readFile(profilePath, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [key])) {
            traceInfo(`SHELL: fish already contains activation code: ${profilePath}`);
            return true;
        }
    }
    traceInfo(`SHELL: fish does not contain activation code: ${profilePath}`);
    return false;
}

async function setupStartup(profilePath: string, key: string): Promise<boolean> {
    try {
        const activationContent = getActivationContent(key);
        await fs.mkdirp(path.dirname(profilePath));

        if (await fs.pathExists(profilePath)) {
            const content = await fs.readFile(profilePath, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [key])) {
                traceInfo(`SHELL: Fish profile at ${profilePath} already contains activation code`);
            } else {
                await fs.writeFile(profilePath, insertStartupCode(content, regionStart, regionEnd, activationContent));
                traceInfo(`SHELL: Updated existing fish profile at: ${profilePath}\n${activationContent}`);
            }
        } else {
            await fs.writeFile(profilePath, insertStartupCode('', regionStart, regionEnd, activationContent));
            traceInfo(`SHELL: Created new fish profile at: ${profilePath}\n${activationContent}`);
        }
        return true;
    } catch (err) {
        traceVerbose(`Failed to setup fish startup`, err);
        return false;
    }
}

async function removeFishStartup(profilePath: string, key: string): Promise<boolean> {
    if (!(await fs.pathExists(profilePath))) {
        return true;
    }

    try {
        const content = await fs.readFile(profilePath, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [key])) {
            await fs.writeFile(profilePath, removeStartupCode(content, regionStart, regionEnd));
            traceInfo(`Removed activation from fish profile at: ${profilePath}, for key: ${key}`);
        }
        return true;
    } catch (err) {
        traceVerbose(`Failed to remove fish startup, for key: ${key}`, err);
        return false;
    }
}

export class FishStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'fish';
    public readonly shellType: string = ShellConstants.FISH;

    async isSetup(): Promise<ShellSetupState> {
        const isInstalled = await isFishInstalled();
        if (!isInstalled) {
            traceVerbose('Fish is not installed');
            return ShellSetupState.NotInstalled;
        }

        try {
            const fishProfile = await getFishProfile();
            const isSetup = await isStartupSetup(fishProfile, FISH_ENV_KEY);
            return isSetup ? ShellSetupState.Setup : ShellSetupState.NotSetup;
        } catch (err) {
            traceError('Failed to check if Fish startup is setup', err);
            return ShellSetupState.NotSetup;
        }
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        const isInstalled = await isFishInstalled();
        if (!isInstalled) {
            traceVerbose('Fish is not installed');
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const fishProfile = await getFishProfile();
            const success = await setupStartup(fishProfile, FISH_ENV_KEY);
            return success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to setup Fish startup', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        const isInstalled = await isFishInstalled();
        if (!isInstalled) {
            traceVerbose('Fish is not installed');
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const fishProfile = await getFishProfile();
            // Remove old environment variable if it exists
            await removeFishStartup(fishProfile, FISH_OLD_ENV_KEY);
            const success = await removeFishStartup(fishProfile, FISH_ENV_KEY);
            return success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to remove Fish startup', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    clearCache(): Promise<void> {
        return Promise.resolve();
    }
}
