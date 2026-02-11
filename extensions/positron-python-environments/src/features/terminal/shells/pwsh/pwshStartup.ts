import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import which from 'which';
import { traceError, traceInfo, traceVerbose } from '../../../../common/logging';
import { isWindows } from '../../../../common/utils/platformUtils';
import { ShellScriptEditState, ShellSetupState, ShellStartupScriptProvider } from '../startupProvider';
import { runCommand } from '../utils';

import assert from 'assert';
import { getWorkspacePersistentState } from '../../../../common/persistentState';
import { ShellConstants } from '../../../common/shellConstants';
import { hasStartupCode, insertStartupCode, removeStartupCode } from '../common/editUtils';
import {
    extractProfilePath,
    PROFILE_TAG_END,
    PROFILE_TAG_START,
} from '../common/shellUtils';
import { POWERSHELL_ENV_KEY, POWERSHELL_OLD_ENV_KEY, PWSH_SCRIPT_VERSION } from './pwshConstants';

const PWSH_PROFILE_PATH_CACHE_KEY = 'PWSH_PROFILE_PATH_CACHE';
const PS5_PROFILE_PATH_CACHE_KEY = 'PS5_PROFILE_PATH_CACHE';
let pwshProfilePath: string | undefined;
let ps5ProfilePath: string | undefined;
function clearPwshCache() {
    ps5ProfilePath = undefined;
    pwshProfilePath = undefined;
}

async function setProfilePathCache(shell: 'powershell' | 'pwsh', profilePath: string): Promise<void> {
    const state = await getWorkspacePersistentState();
    if (shell === 'powershell') {
        ps5ProfilePath = profilePath;
        await state.set(PS5_PROFILE_PATH_CACHE_KEY, profilePath);
    } else {
        pwshProfilePath = profilePath;
        await state.set(PWSH_PROFILE_PATH_CACHE_KEY, profilePath);
    }
}

function getProfilePathCache(shell: 'powershell' | 'pwsh'): string | undefined {
    if (shell === 'powershell') {
        return ps5ProfilePath;
    } else {
        return pwshProfilePath;
    }
}

async function isPowerShellInstalled(shell: string): Promise<boolean> {
    try {
        await which(shell);
        return true;
    } catch {
        traceVerbose(`${shell} is not installed`);
        return false;
    }
}

/**
 * Detects the major version of PowerShell by executing a version query command.
 * This helps with debugging activation issues since PowerShell 5.x and 7+ have different behaviors.
 * @param shell The PowerShell executable name ('powershell' for Windows PowerShell or 'pwsh' for PowerShell Core/7+)
 * @returns Promise resolving to the major version number as a string, or undefined if detection fails
 */
async function getPowerShellVersion(shell: 'powershell' | 'pwsh'): Promise<string | undefined> {
    try {
        const command = `${shell} -c '\$PSVersionTable.PSVersion.Major'`;
        const versionOutput = await runCommand(command);
        if (versionOutput && !isNaN(Number(versionOutput))) {
            return versionOutput;
        }
        traceVerbose(`Failed to parse PowerShell version from output: ${versionOutput}`);
        return undefined;
    } catch (err) {
        traceVerbose(`Failed to get PowerShell version for ${shell}`, err);
        return undefined;
    }
}

async function getProfileForShell(shell: 'powershell' | 'pwsh'): Promise<string> {
    const cachedPath = getProfilePathCache(shell);
    if (cachedPath) {
        traceInfo(`SHELL: ${shell} profile path from cache: ${cachedPath}`);
        return cachedPath;
    }

    try {
        const content = await runCommand(
            isWindows()
                ? `${shell} -Command "Write-Output '${PROFILE_TAG_START}'; Write-Output $profile; Write-Output '${PROFILE_TAG_END}'"`
                : `${shell} -Command "Write-Output '${PROFILE_TAG_START}'; Write-Output \\$profile; Write-Output '${PROFILE_TAG_END}'"`,
        );

        if (content) {
            const profilePath = extractProfilePath(content);
            if (profilePath) {
                setProfilePathCache(shell, profilePath);
                traceInfo(`SHELL: ${shell} profile found at: ${profilePath}`);
                return profilePath;
            }
        }
    } catch (err) {
        traceError(`${shell} failed to get profile path`, err);
    }

    let profile: string;
    if (isWindows()) {
        if (shell === 'powershell') {
            profile = path.join(
                process.env.USERPROFILE || os.homedir(),
                'Documents',
                'WindowsPowerShell',
                'Microsoft.PowerShell_profile.ps1',
            );
        } else {
            profile = path.join(
                process.env.USERPROFILE || os.homedir(),
                'Documents',
                'PowerShell',
                'Microsoft.PowerShell_profile.ps1',
            );
        }
    } else {
        profile = path.join(
            process.env.HOME || os.homedir(),
            '.config',
            'powershell',
            'Microsoft.PowerShell_profile.ps1',
        );
    }
    traceInfo(`SHELL: ${shell} profile not found, using default path: ${profile}`);
    return profile;
}

const regionStart = '#region vscode python';
const regionEnd = '#endregion vscode python';
function getActivationContent(): string {
    const lineSep = isWindows() ? '\r\n' : '\n';
    const activationContent = [
        `#version: ${PWSH_SCRIPT_VERSION}`,
        `if (-not $env:VSCODE_PYTHON_AUTOACTIVATE_GUARD) {`,
        `    $env:VSCODE_PYTHON_AUTOACTIVATE_GUARD = '1'`,
        `    if (($env:TERM_PROGRAM -eq 'vscode') -and ($null -ne $env:${POWERSHELL_ENV_KEY})) {`,
        '        try {',
        `            Invoke-Expression $env:${POWERSHELL_ENV_KEY}`,
        '        } catch {',
        `            $psVersion = $PSVersionTable.PSVersion.Major`,
        `            Write-Error "Failed to activate Python environment (PowerShell $psVersion): $_" -ErrorAction Continue`,
        '        }',
        '    }',
        '}',
    ].join(lineSep);
    return activationContent;
}

async function isPowerShellStartupSetup(shell: string, profile: string): Promise<boolean> {
    if (await fs.pathExists(profile)) {
        const content = await fs.readFile(profile, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [POWERSHELL_ENV_KEY])) {
            traceInfo(`SHELL: ${shell} already contains activation code: ${profile}`);
            return true;
        }
    }
    traceInfo(`SHELL: ${shell} does not contain activation code: ${profile}`);
    return false;
}

async function setupPowerShellStartup(shell: string, profile: string): Promise<boolean> {
    const activationContent = getActivationContent();

    try {
        if (await fs.pathExists(profile)) {
            const content = await fs.readFile(profile, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [POWERSHELL_ENV_KEY])) {
                traceInfo(`SHELL: ${shell} already contains activation code: ${profile}`);
            } else {
                await fs.writeFile(profile, insertStartupCode(content, regionStart, regionEnd, activationContent));
                traceInfo(`SHELL: Updated existing ${shell} profile at: ${profile}\r\n${activationContent}`);
            }
        } else {
            await fs.mkdirp(path.dirname(profile));
            await fs.writeFile(profile, insertStartupCode('', regionStart, regionEnd, activationContent));
            traceInfo(`SHELL: Created new ${shell} profile at: ${profile}\r\n${activationContent}`);
        }
        return true;
    } catch (err) {
        traceError(`Failed to setup ${shell} startup`, err);
        return false;
    }
}

async function removePowerShellStartup(shell: string, profile: string, key: string): Promise<boolean> {
    if (!(await fs.pathExists(profile))) {
        return true;
    }

    try {
        const content = await fs.readFile(profile, 'utf8');
        if (hasStartupCode(content, regionStart, regionEnd, [key])) {
            await fs.writeFile(profile, removeStartupCode(content, regionStart, regionEnd));
            traceInfo(`SHELL: Removed activation from ${shell} profile at: ${profile}, for key: ${key}`);
        } else {
            traceInfo(`SHELL: No activation code found in ${shell} profile at: ${profile}, for key: ${key}`);
        }
        return true;
    } catch (err) {
        traceError(`SHELL: Failed to remove startup code for ${shell} profile at: ${profile}, for key: ${key}`, err);
        return false;
    }
}

type PowerShellType = 'powershell' | 'pwsh';

export class PwshStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'PowerShell';
    public readonly shellType: string = ShellConstants.PWSH;

    private _isPwshInstalled: boolean | undefined;
    private _isPs5Installed: boolean | undefined;
    private _supportedShells: PowerShellType[];

    constructor(supportedShells: PowerShellType[]) {
        assert(supportedShells.length > 0, 'At least one PowerShell shell must be supported');
        this._supportedShells = supportedShells;
    }

    private async checkInstallations(): Promise<Map<PowerShellType, boolean>> {
        const results = new Map<PowerShellType, boolean>();

        await Promise.all(
            this._supportedShells.map(async (shell) => {
                if (shell === 'pwsh' && this._isPwshInstalled !== undefined) {
                    results.set(shell, this._isPwshInstalled);
                } else if (shell === 'powershell' && this._isPs5Installed !== undefined) {
                    results.set(shell, this._isPs5Installed);
                } else {
                    const isInstalled = await isPowerShellInstalled(shell);
                    if (isInstalled) {
                        // Log PowerShell version for debugging activation issues
                        const version = await getPowerShellVersion(shell);
                        const versionText = version ? ` (version ${version})` : ' (version unknown)';
                        traceInfo(`SHELL: ${shell} is installed${versionText}`);
                    }
                    if (shell === 'pwsh') {
                        this._isPwshInstalled = isInstalled;
                    } else {
                        this._isPs5Installed = isInstalled;
                    }
                    results.set(shell, isInstalled);
                }
            }),
        );

        return results;
    }

    async isSetup(): Promise<ShellSetupState> {
        const installations = await this.checkInstallations();

        if (Array.from(installations.values()).every((installed) => !installed)) {
            return ShellSetupState.NotInstalled;
        }

        const results: ShellSetupState[] = [];
        for (const [shell, installed] of installations.entries()) {
            if (!installed) {
                continue;
            }

            try {
                const profile = await getProfileForShell(shell);
                const isSetup = await isPowerShellStartupSetup(shell, profile);
                results.push(isSetup ? ShellSetupState.Setup : ShellSetupState.NotSetup);
            } catch (err) {
                traceError(`Failed to check if ${shell} startup is setup`, err);
                results.push(ShellSetupState.NotSetup);
            }
        }

        if (results.includes(ShellSetupState.NotSetup)) {
            return ShellSetupState.NotSetup;
        }

        return ShellSetupState.Setup;
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        const installations = await this.checkInstallations();

        if (Array.from(installations.values()).every((installed) => !installed)) {
            return ShellScriptEditState.NotInstalled;
        }

        const anyEdited = [];
        for (const [shell, installed] of installations.entries()) {
            if (!installed) {
                continue;
            }

            try {
                const profile = await getProfileForShell(shell);
                const success = await setupPowerShellStartup(shell, profile);
                anyEdited.push(success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited);
            } catch (err) {
                traceError(`Failed to setup ${shell} startup`, err);
            }
        }
        return anyEdited.every((state) => state === ShellScriptEditState.Edited)
            ? ShellScriptEditState.Edited
            : ShellScriptEditState.NotEdited;
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        const installations = await this.checkInstallations();

        if (Array.from(installations.values()).every((installed) => !installed)) {
            return ShellScriptEditState.NotInstalled;
        }

        const anyEdited = [];
        for (const [shell, installed] of installations.entries()) {
            if (!installed) {
                continue;
            }

            try {
                const profile = await getProfileForShell(shell);
                // Remove old environment variable if it exists
                await removePowerShellStartup(shell, profile, POWERSHELL_OLD_ENV_KEY);
                const success = await removePowerShellStartup(shell, profile, POWERSHELL_ENV_KEY);
                anyEdited.push(success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited);
            } catch (err) {
                traceError(`Failed to remove ${shell} startup`, err);
            }
        }
        return anyEdited.every((state) => state === ShellScriptEditState.Edited)
            ? ShellScriptEditState.Edited
            : ShellScriptEditState.NotEdited;
    }

    async clearCache(): Promise<void> {
        clearPwshCache();
        // Reset installation check cache as well
        this._isPwshInstalled = undefined;
        this._isPs5Installed = undefined;
    }
}
