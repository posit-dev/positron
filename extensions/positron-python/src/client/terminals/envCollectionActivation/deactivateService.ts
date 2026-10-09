/* eslint-disable class-methods-use-this */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { inject, injectable } from 'inversify';
import * as path from 'path';
import { ITerminalManager } from '../../common/application/types';
// --- Start Positron ---
// import { pathExists } from '../../common/platform/fs-paths';
import { copyFile, pathExists } from '../../common/platform/fs-paths';
// --- End Positron ---
import { _SCRIPTS_DIR } from '../../common/process/internal/scripts/constants';
import { identifyShellFromShellPath } from '../../common/terminal/shellDetectors/baseShellDetector';
import { ITerminalHelper, TerminalShellType } from '../../common/terminal/types';
// --- Start Positron ---
// import { Resource } from '../../common/types';
import { IExtensionContext, Resource } from '../../common/types';
// --- End Positron ---
import { waitForCondition } from '../../common/utils/async';
import { cache } from '../../common/utils/decorators';
import { StopWatch } from '../../common/utils/stopWatch';
import { IInterpreterService } from '../../interpreter/contracts';
import { traceVerbose } from '../../logging';
import { PythonEnvType } from '../../pythonEnvironments/base/info';
import { ITerminalDeactivateService } from '../types';

/**
 * This is a list of shells which support shell integration:
 * https://code.visualstudio.com/docs/terminal/shell-integration
 */
const ShellIntegrationShells = [
    TerminalShellType.powershell,
    TerminalShellType.powershellCore,
    TerminalShellType.bash,
    TerminalShellType.zsh,
    TerminalShellType.fish,
];

@injectable()
export class TerminalDeactivateService implements ITerminalDeactivateService {
    private readonly envVarScript = path.join(_SCRIPTS_DIR, 'printEnvVariablesToFile.py');

    // --- Start Positron ---
    // constructor(
    //     @inject(ITerminalManager) private readonly terminalManager: ITerminalManager,
    //     @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
    //     @inject(ITerminalHelper) private readonly terminalHelper: ITerminalHelper,
    // ) {}
    constructor(
        @inject(ITerminalManager) private readonly terminalManager: ITerminalManager,
        @inject(IInterpreterService) private readonly interpreterService: IInterpreterService,
        @inject(ITerminalHelper) private readonly terminalHelper: ITerminalHelper,
        @inject(IExtensionContext) private readonly context: IExtensionContext,
    ) {}
    // --- End Positron ---

    @cache(-1, true)
    public async initializeScriptParams(shell: string): Promise<void> {
        const location = this.getLocation(shell);
        if (!location) {
            return;
        }
        const shellType = identifyShellFromShellPath(shell);
        // --- Start Positron ---
        // The script reads envVars.txt from its own folder, and the extension
        // folder can be inside a signed or read-only app bundle. Copy the
        // script to global storage so that both files are written there.
        const scriptName = this.getScriptName(shellType);
        await copyFile(
            path.join(_SCRIPTS_DIR, 'deactivate', this.getShellFolderName(shellType), scriptName),
            path.join(location, scriptName),
        );
        // --- End Positron ---
        const terminal = this.terminalManager.createTerminal({
            name: `Python ${shellType} Deactivate`,
            shellPath: shell,
            hideFromUser: true,
            cwd: location,
        });
        const globalInterpreters = this.interpreterService.getInterpreters().filter((i) => !i.type);
        const outputFile = path.join(location, `envVars.txt`);
        const interpreterPath =
            globalInterpreters.length > 0 && globalInterpreters[0] ? globalInterpreters[0].path : 'python';
        const checkIfFileHasBeenCreated = () => pathExists(outputFile);
        const stopWatch = new StopWatch();
        const command = this.terminalHelper.buildCommandForTerminal(shellType, interpreterPath, [
            this.envVarScript,
            outputFile,
        ]);
        terminal.sendText(command);
        await waitForCondition(checkIfFileHasBeenCreated, 30_000, `"${outputFile}" file not created`);
        traceVerbose(`Time taken to get env vars using terminal is ${stopWatch.elapsedTime}ms`);
    }

    public async getScriptLocation(shell: string, resource: Resource): Promise<string | undefined> {
        const interpreter = await this.interpreterService.getActiveInterpreter(resource);
        if (interpreter?.type !== PythonEnvType.Virtual) {
            return undefined;
        }
        return this.getLocation(shell);
    }

    private getLocation(shell: string) {
        const shellType = identifyShellFromShellPath(shell);
        if (!ShellIntegrationShells.includes(shellType)) {
            return undefined;
        }
        // --- Start Positron ---
        // return path.join(_SCRIPTS_DIR, 'deactivate', this.getShellFolderName(shellType));
        return path.join(this.context.globalStorageUri.fsPath, 'deactivate', this.getShellFolderName(shellType));
        // --- End Positron ---
    }

    // --- Start Positron ---
    private getScriptName(shellType: TerminalShellType): string {
        switch (shellType) {
            case TerminalShellType.powershell:
            case TerminalShellType.powershellCore:
                return 'deactivate.ps1';
            default:
                return 'deactivate';
        }
    }
    // --- End Positron ---

    private getShellFolderName(shellType: TerminalShellType): string {
        switch (shellType) {
            case TerminalShellType.powershell:
            case TerminalShellType.powershellCore:
                return 'powershell';
            case TerminalShellType.fish:
                return 'fish';
            case TerminalShellType.zsh:
                return 'zsh';
            case TerminalShellType.bash:
                return 'bash';
            default:
                throw new Error(`Unsupported shell type ${shellType}`);
        }
    }
}
