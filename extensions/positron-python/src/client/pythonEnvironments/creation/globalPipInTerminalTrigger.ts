import { Disposable, TerminalShellExecutionStartEvent } from 'vscode';
import {
    disableCreateEnvironmentTrigger,
    isGlobalPythonSelected,
    shouldPromptToCreateEnv,
} from './common/createEnvTriggerUtils';
import { getWorkspaceFolder, getWorkspaceFolders } from '../../common/vscodeApis/workspaceApis';
import { Common, CreateEnv } from '../../common/utils/localize';
import { traceError, traceInfo } from '../../logging';
import { executeCommand } from '../../common/vscodeApis/commandApis';
import { Commands, PVSC_EXTENSION_ID } from '../../common/constants';
import { CreateEnvironmentResult } from './proposed.createEnvApis';
import { onDidStartTerminalShellExecution, showWarningMessage } from '../../common/vscodeApis/windowApis';
import { sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
// --- Start Positron ---
import { IInterpreterService } from '../../interpreter/contracts';
// --- End Positron ---

function checkCommand(command: string): boolean {
    const lower = command.toLowerCase();
    return (
        lower.startsWith('pip install') ||
        lower.startsWith('pip3 install') ||
        lower.startsWith('python -m pip install') ||
        lower.startsWith('python3 -m pip install')
    );
}

// --- Start Positron ---
// export function registerTriggerForPipInTerminal(disposables: Disposable[]): void {
export function registerTriggerForPipInTerminal(
    disposables: Disposable[],
    interpreterService: IInterpreterService,
): void {
    // --- End Positron ---
    if (!shouldPromptToCreateEnv()) {
        return;
    }

    const folders = getWorkspaceFolders();
    if (!folders || folders.length === 0) {
        return;
    }

    const createEnvironmentTriggered: Map<string, boolean> = new Map();
    folders.forEach((workspaceFolder) => {
        createEnvironmentTriggered.set(workspaceFolder.uri.fsPath, false);
    });

    disposables.push(
        onDidStartTerminalShellExecution(async (e: TerminalShellExecutionStartEvent) => {
            const workspaceFolder = getWorkspaceFolder(e.shellIntegration.cwd);
            if (
                workspaceFolder &&
                !createEnvironmentTriggered.get(workspaceFolder.uri.fsPath) &&
                // --- Start Positron ---
                // (await isGlobalPythonSelected(workspaceFolder))
                (await isGlobalPythonSelected(workspaceFolder, interpreterService))
                // --- End Positron ---
            ) {
                if (e.execution.commandLine.isTrusted && checkCommand(e.execution.commandLine.value)) {
                    createEnvironmentTriggered.set(workspaceFolder.uri.fsPath, true);
                    sendTelemetryEvent(EventName.ENVIRONMENT_TERMINAL_GLOBAL_PIP);
                    const selection = await showWarningMessage(
                        CreateEnv.Trigger.globalPipInstallTriggerMessage,
                        CreateEnv.Trigger.createEnvironment,
                        Common.doNotShowAgain,
                    );
                    if (selection === CreateEnv.Trigger.createEnvironment) {
                        try {
                            const result: CreateEnvironmentResult = await executeCommand(Commands.Create_Environment, {
                                workspaceFolder,
                                providerId: `${PVSC_EXTENSION_ID}:venv`,
                            });
                            if (result.path) {
                                traceInfo('CreateEnv Trigger - Environment created: ', result.path);
                                traceInfo(
                                    `CreateEnv Trigger - Running: ${
                                        result.path
                                    } -m ${e.execution.commandLine.value.trim()}`,
                                );
                                e.shellIntegration.executeCommand(
                                    `${result.path} -m ${e.execution.commandLine.value}`.trim(),
                                );
                            }
                        } catch (error) {
                            traceError('CreateEnv Trigger - Error while creating environment: ', error);
                        }
                    } else if (selection === Common.doNotShowAgain) {
                        disableCreateEnvironmentTrigger();
                    }
                }
            }
        }),
    );
}
