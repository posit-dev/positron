import * as cp from 'child_process';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import which from 'which';
import { traceError, traceInfo, traceVerbose } from '../../../../common/logging';
import { StopWatch } from '../../../../common/stopWatch';
import { isWindows } from '../../../../common/utils/platformUtils';
import { ShellConstants } from '../../../common/shellConstants';
import { hasStartupCode, insertStartupCode, removeStartupCode } from '../common/editUtils';
import { ShellScriptEditState, ShellSetupState, ShellStartupScriptProvider } from '../startupProvider';
import { CMD_ENV_KEY, CMD_SCRIPT_VERSION } from './cmdConstants';

function execCommand(command: string) {
    const timer = new StopWatch();
    return promisify(cp.exec)(command, { windowsHide: true }).finally(() =>
        traceInfo(`Executed command: ${command} in ${timer.elapsedTime}`),
    );
}

async function isCmdInstalled(): Promise<boolean> {
    if (!isWindows()) {
        return false;
    }

    if (process.env.ComSpec && (await fs.exists(process.env.ComSpec))) {
        return true;
    }

    try {
        // Try to find cmd.exe on the system
        await which('cmd.exe', { nothrow: true });
        return true;
    } catch {
        // This should normally not happen on Windows
        return false;
    }
}

interface CmdFilePaths {
    startupFile: string;
    regStartupFile: string;
    mainBatchFile: string;
    regMainBatchFile: string;
    mainName: string;
    startupName: string;
}

async function getCmdFilePaths(): Promise<CmdFilePaths> {
    const homeDir = process.env.USERPROFILE ?? os.homedir();
    const cmdrcDir = path.join(homeDir, '.cmdrc');
    await fs.ensureDir(cmdrcDir);

    return {
        mainBatchFile: path.join(cmdrcDir, 'cmd_startup.bat'),
        regMainBatchFile: path.join('%USERPROFILE%', '.cmdrc', 'cmd_startup.bat'),
        mainName: 'cmd_startup.bat',
        startupFile: path.join(cmdrcDir, 'vscode-python.bat'),
        regStartupFile: path.join('%USERPROFILE%', '.cmdrc', 'vscode-python.bat'),
        startupName: 'vscode-python.bat',
    };
}

const regionStart = ':: >>> vscode python';
const regionEnd = ':: <<< vscode python';

function getActivationContent(key: string): string {
    const lineSep = '\r\n';
    return [`:: version: ${CMD_SCRIPT_VERSION}`, `if defined ${key} (`, `    call %${key}%`, ')'].join(lineSep);
}

function getHeader(): string {
    const lineSep = '\r\n';
    const content = [];
    content.push('@echo off');
    content.push(':: startup used in HKCU\\Software\\Microsoft\\Command Processor key AutoRun');
    content.push('');
    return content.join(lineSep);
}

function getMainBatchFileContent(startupFile: string): string {
    const lineSep = '\r\n';
    const content = [];

    content.push('if "%TERM_PROGRAM%"=="vscode" (');
    content.push('    if not defined VSCODE_PYTHON_AUTOACTIVATE_GUARD (');
    content.push('        set "VSCODE_PYTHON_AUTOACTIVATE_GUARD=1"');
    content.push(`        if exist "${startupFile}" call "${startupFile}"`);
    content.push('    )');
    content.push(')');

    return content.join(lineSep);
}

async function checkRegistryAutoRun(mainBatchFile: string, regMainBatchFile: string): Promise<boolean> {
    if (!isWindows()) {
        return false;
    }

    try {
        // Check if AutoRun is set in the registry to call our batch file
        const { stdout } = await execCommand('reg query "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun');

        // Check if the output contains our batch file path
        return stdout.includes(regMainBatchFile) || stdout.includes(mainBatchFile);
    } catch {
        // If the command fails, the registry key might not exist
        return false;
    }
}

async function getExistingAutoRun(): Promise<string | undefined> {
    if (!isWindows()) {
        return undefined;
    }

    try {
        const { stdout } = await execCommand('reg query "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun');

        const match = stdout.match(/AutoRun\s+REG_SZ\s+(.*)/);
        if (match && match[1]) {
            const content = match[1].trim();
            return content;
        }
    } catch {
        // Key doesn't exist yet
    }

    return undefined;
}

async function setupRegistryAutoRun(mainBatchFile: string): Promise<boolean> {
    if (!isWindows()) {
        return false;
    }

    try {
        // Set the registry key to call our main batch file
        await execCommand(
            `reg add "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /t REG_SZ /d "if exist \\"${mainBatchFile}\\" call \\"${mainBatchFile}\\"" /f`,
        );

        traceInfo(
            `Set CMD AutoRun registry key [HKCU\\Software\\Microsoft\\Command Processor] to call: ${mainBatchFile}`,
        );
        return true;
    } catch (err) {
        traceError('Failed to set CMD AutoRun registry key [HKCU\\Software\\Microsoft\\Command Processor]', err);
        return false;
    }
}

async function isCmdStartupSetup(cmdFiles: CmdFilePaths, key: string): Promise<ShellSetupState> {
    const fileExists = await fs.pathExists(cmdFiles.startupFile);
    let fileHasContent = false;
    if (fileExists) {
        const content = await fs.readFile(cmdFiles.startupFile, 'utf8');
        fileHasContent = hasStartupCode(content, regionStart, regionEnd, [key]);
    }

    if (!fileHasContent) {
        return ShellSetupState.NotSetup;
    }

    const mainFileExists = await fs.pathExists(cmdFiles.mainBatchFile);
    let mainFileHasContent = false;
    if (mainFileExists) {
        const mainFileContent = await fs.readFile(cmdFiles.mainBatchFile, 'utf8');
        mainFileHasContent = hasStartupCode(mainFileContent, regionStart, regionEnd, [cmdFiles.startupName]);
    }

    if (!mainFileHasContent) {
        return ShellSetupState.NotSetup;
    }

    const registrySetup = await checkRegistryAutoRun(cmdFiles.regMainBatchFile, cmdFiles.mainBatchFile);
    return registrySetup ? ShellSetupState.Setup : ShellSetupState.NotSetup;
}

async function setupCmdStartup(cmdFiles: CmdFilePaths, key: string): Promise<boolean> {
    try {
        const activationContent = getActivationContent(key);

        // Step 1: Create or update the activation file
        if (await fs.pathExists(cmdFiles.startupFile)) {
            const content = await fs.readFile(cmdFiles.startupFile, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [key])) {
                traceInfo(`SHELL: CMD activation file at ${cmdFiles.startupFile} already contains activation code`);
            } else {
                await fs.writeFile(
                    cmdFiles.startupFile,
                    insertStartupCode(content, regionStart, regionEnd, activationContent),
                );
                traceInfo(
                    `SHELL: Updated existing CMD activation file at: ${cmdFiles.startupFile}\r\n${activationContent}`,
                );
            }
        } else {
            await fs.writeFile(
                cmdFiles.startupFile,
                insertStartupCode(getHeader(), regionStart, regionEnd, activationContent),
            );
            traceInfo(`SHELL: Created new CMD activation file at: ${cmdFiles.startupFile}\r\n${activationContent}`);
        }

        // Step 2: Get existing AutoRun content
        const existingAutoRun = await getExistingAutoRun();

        // Step 3: Create or update the main batch file
        if (await fs.pathExists(cmdFiles.mainBatchFile)) {
            const content = await fs.readFile(cmdFiles.mainBatchFile, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [cmdFiles.startupName])) {
                traceInfo(`SHELL: CMD main batch file at ${cmdFiles.mainBatchFile} already contains our startup file`);
            } else {
                const mainBatchContent = getMainBatchFileContent(cmdFiles.regStartupFile);
                await fs.writeFile(
                    cmdFiles.mainBatchFile,
                    insertStartupCode(content, regionStart, regionEnd, mainBatchContent),
                );
                traceInfo(
                    `SHELL: Updated existing main batch file at: ${cmdFiles.mainBatchFile}\r\n${mainBatchContent}`,
                );
            }
        } else {
            const mainBatchContent = getMainBatchFileContent(cmdFiles.regStartupFile);
            await fs.writeFile(
                cmdFiles.mainBatchFile,
                insertStartupCode(getHeader(), regionStart, regionEnd, mainBatchContent),
            );
            traceInfo(`SHELL: Created new main batch file at: ${cmdFiles.mainBatchFile}\r\n${mainBatchContent}`);
        }

        // Step 4: Setup registry AutoRun to call our main batch file
        if (existingAutoRun?.includes(cmdFiles.regMainBatchFile) || existingAutoRun?.includes(cmdFiles.mainBatchFile)) {
            traceInfo(`SHELL: CMD AutoRun registry key already contains our main batch file`);
        } else {
            const registrySetup = await setupRegistryAutoRun(cmdFiles.mainBatchFile);
            return registrySetup;
        }
        return true;
    } catch (err) {
        traceVerbose(`Failed to setup CMD startup`, err);
        return false;
    }
}

async function removeCmdStartup(startupFile: string, key: string): Promise<boolean> {
    // Note: We deliberately DO NOT remove the main batch file or registry AutoRun setting
    // This allows other components to continue using the AutoRun functionality
    if (await fs.pathExists(startupFile)) {
        try {
            const content = await fs.readFile(startupFile, 'utf8');
            if (hasStartupCode(content, regionStart, regionEnd, [key])) {
                await fs.writeFile(startupFile, removeStartupCode(content, regionStart, regionEnd));
                traceInfo(`Removed activation from CMD activation file at: ${startupFile}`);
            } else {
                traceInfo(`CMD activation file at ${startupFile} does not contain activation code`);
            }
        } catch (err) {
            traceVerbose(`Failed to remove CMD activation file content`, err);
            return false;
        }
    }
    return true;
}

export class CmdStartupProvider implements ShellStartupScriptProvider {
    public readonly name: string = 'Command Prompt';
    public readonly shellType: string = ShellConstants.CMD;

    async isSetup(): Promise<ShellSetupState> {
        const isInstalled = await isCmdInstalled();
        if (!isInstalled) {
            traceVerbose('CMD is not installed or not on Windows');
            return ShellSetupState.NotInstalled;
        }

        try {
            const cmdFiles = await getCmdFilePaths();
            const isSetup = await isCmdStartupSetup(cmdFiles, CMD_ENV_KEY);
            return isSetup;
        } catch (err) {
            traceError('Failed to check if CMD startup is setup', err);
            return ShellSetupState.NotSetup;
        }
    }

    async setupScripts(): Promise<ShellScriptEditState> {
        const isInstalled = await isCmdInstalled();
        if (!isInstalled) {
            traceVerbose('CMD is not installed or not on Windows');
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const cmdFiles = await getCmdFilePaths();
            const success = await setupCmdStartup(cmdFiles, CMD_ENV_KEY);
            return success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to setup CMD startup', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    async teardownScripts(): Promise<ShellScriptEditState> {
        const isInstalled = await isCmdInstalled();
        if (!isInstalled) {
            traceVerbose('CMD is not installed or not on Windows');
            return ShellScriptEditState.NotInstalled;
        }

        try {
            const { startupFile } = await getCmdFilePaths();
            const success = await removeCmdStartup(startupFile, CMD_ENV_KEY);
            return success ? ShellScriptEditState.Edited : ShellScriptEditState.NotEdited;
        } catch (err) {
            traceError('Failed to remove CMD startup', err);
            return ShellScriptEditState.NotEdited;
        }
    }

    clearCache(): Promise<void> {
        return Promise.resolve();
    }
}
