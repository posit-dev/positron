// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { inject, injectable } from 'inversify';
import { Disposable, EventEmitter, Terminal, Uri } from 'vscode';
// --- Start Positron ---
import * as vscode from 'vscode';
import * as positron from 'positron';
// --- End Positron ---

import * as path from 'path';
// --- Start Positron ---
import * as os from 'os';
// --- End Positron ---
import { ICommandManager, IDocumentManager } from '../../common/application/types';
import { Commands } from '../../common/constants';
import '../../common/extensions';
import { IDisposableRegistry, IConfigurationService, Resource } from '../../common/types';
import { noop } from '../../common/utils/misc';
import { IInterpreterService } from '../../interpreter/contracts';
import { IServiceContainer } from '../../ioc/types';
import { traceError, traceVerbose } from '../../logging';
import { captureTelemetry, sendTelemetryEvent } from '../../telemetry';
import { EventName } from '../../telemetry/constants';
import { ICodeExecutionHelper, ICodeExecutionManager, ICodeExecutionService } from '../../terminals/types';
import {
    CreateEnvironmentCheckKind,
    triggerCreateEnvironmentCheckNonBlocking,
} from '../../pythonEnvironments/creation/createEnvironmentTrigger';
import { ReplType } from '../../repl/types';
import { runInDedicatedTerminal, runInTerminal, useEnvExtension } from '../../envExt/api.internal';
// --- Start Positron ---
import { UnsavedScriptFiles } from './unsavedScripts';
// --- End Positron ---

@injectable()
export class CodeExecutionManager implements ICodeExecutionManager {
    private eventEmitter: EventEmitter<string> = new EventEmitter<string>();
    // --- Start Positron ---
    /** Backs the "run file" gesture for unsaved (untitled) Python scripts. */
    private readonly unsavedScripts = new UnsavedScriptFiles();
    // --- End Positron ---
    constructor(
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IDocumentManager) private documentManager: IDocumentManager,
        @inject(IDisposableRegistry) private disposableRegistry: Disposable[],
        @inject(IConfigurationService) private readonly configSettings: IConfigurationService,
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
    ) {}

    public registerCommands() {
        // --- Start Positron ---
        this.disposableRegistry.push(this.unsavedScripts);
        // --- End Positron ---
        [Commands.Exec_In_Terminal, Commands.Exec_In_Terminal_Icon, Commands.Exec_In_Separate_Terminal].forEach(
            (cmd) => {
                this.disposableRegistry.push(
                    this.commandManager.registerCommand(cmd as any, async (file: Resource) => {
                        traceVerbose(`Attempting to run Python file`, file?.fsPath);
                        const trigger = cmd === Commands.Exec_In_Terminal ? 'command' : 'icon';
                        const newTerminalPerFile = cmd === Commands.Exec_In_Separate_Terminal;

                        if (useEnvExtension()) {
                            try {
                                await this.executeUsingExtension(file, cmd === Commands.Exec_In_Separate_Terminal);
                            } catch (ex) {
                                traceError('Failed to execute file in terminal', ex);
                            }
                            sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, {
                                trigger: 'run-in-terminal',
                            });
                            sendTelemetryEvent(EventName.EXECUTION_CODE, undefined, {
                                scope: 'file',
                                trigger,
                                newTerminalPerFile,
                            });
                            return;
                        }

                        const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                        const interpreter = await interpreterService.getActiveInterpreter(file);
                        if (!interpreter) {
                            this.commandManager
                                .executeCommand(Commands.TriggerEnvironmentSelection, file)
                                .then(noop, noop);
                            return;
                        }
                        sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, {
                            trigger: 'run-in-terminal',
                        });
                        triggerCreateEnvironmentCheckNonBlocking(CreateEnvironmentCheckKind.File, file);

                        await this.executeFileInTerminal(file, trigger, {
                            newTerminalPerFile,
                        })
                            .then(() => {
                                if (this.shouldTerminalFocusOnStart(file))
                                    this.commandManager.executeCommand('workbench.action.terminal.focus');
                            })
                            .catch((ex) => traceError('Failed to execute file in terminal', ex));
                    }),
                );
            },
        );
        // --- Start Positron ---
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.Exec_In_Console as any, async (resource?: Uri) => {
                // Resolve the target document from the resource URI (editor
                // action bar button) or the active editor (command palette).
                const document = resource
                    ? await vscode.workspace.openTextDocument(resource)
                    : vscode.window.activeTextEditor?.document;
                if (!document) {
                    // No editor; nothing to do
                    return;
                }

                // Unsaved (untitled) buffers are written to a scratch file so
                // they can be run without prompting the user to save first. The
                // scratch file is cleaned up once the run finishes.
                let filePath: string | undefined;
                let onFinished: (() => void) | undefined;
                if (document.isUntitled) {
                    filePath = await this.unsavedScripts.write(document);
                    onFinished = () => {
                        void this.unsavedScripts.finished(filePath!);
                    };
                } else {
                    filePath = document.uri.fsPath;
                    if (!filePath) {
                        vscode.window.showWarningMessage('Cannot source unsaved file.');
                        return;
                    }
                    // Save the file before running it so that the contents on
                    // disk are up to date with the editor buffer.
                    if (document.isDirty) {
                        await document.save();
                    }
                }

                try {
                    // Check to see if the fsPath is an actual path to a file using
                    // the VS Code file system API.
                    const fsStat = await vscode.workspace.fs.stat(vscode.Uri.file(filePath));

                    if (fsStat) {
                        const fileUri = vscode.Uri.file(filePath);

                        // Format the path relative to the session's working
                        // directory when possible, falling back to home-relative
                        // or absolute. IPython's %run expands ~ and reads the
                        // file from disk.
                        const formattedPath = await positron.paths.formatPathForCode(filePath, {
                            relativeTo: ['session', 'home'],
                            homeUri: vscode.Uri.file(os.homedir()),
                        });

                        // Use -- to ensure everything after is treated as the path, not flags
                        // This prevents paths with -m (or other dash options) from being misinterpreted
                        const command = `%run -- ${formattedPath}`;

                        // Offer to install missing packages before running. The
                        // preflight runs in the Positron frontend and returns
                        // whether to proceed (false only if the user cancels).
                        const shouldRun = await vscode.commands.executeCommand<boolean>(
                            'positron.missingPackages.preflight',
                            fileUri,
                        );
                        if (shouldRun === false) {
                            onFinished?.();
                            return;
                        }

                        const observer = onFinished ? { onFinished } : undefined;
                        // Not awaited: the run proceeds asynchronously and the
                        // observer reports completion. If the call itself rejects
                        // (e.g. no session can be started), the observer's
                        // onFinished never fires, so clean up the scratch file here.
                        Promise.resolve(
                            positron.runtime.executeCode(
                                'python',
                                command,
                                false,
                                true,
                                undefined,
                                undefined,
                                observer,
                                undefined,
                                fileUri,
                            ),
                        ).catch(() => onFinished?.());
                    } else {
                        onFinished?.();
                    }
                } catch (e) {
                    onFinished?.();
                    // This is not a valid file path, which isn't an error; it just
                    // means the active editor has something loaded into it that
                    // isn't a file on disk.  In Positron, there is currently a bug
                    // which causes the REPL to act like an active editor. See:
                    //
                    // https://github.com/rstudio/positron/issues/780
                }
            }),
        );
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.Exec_Selection_In_Console as any, async () => {
                // Wrapper for passing the allowIncomplete opt to the console's executeCode command
                await vscode.commands.executeCommand('workbench.action.positronConsole.executeCode', {
                    allowIncomplete: true,
                });
            }),
        );
        // --- End Positron ---
        this.disposableRegistry.push(
            this.commandManager.registerCommand(Commands.Exec_Selection_In_Terminal as any, async (file: Resource) => {
                const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                const interpreter = await interpreterService.getActiveInterpreter(file);
                if (!interpreter) {
                    this.commandManager.executeCommand(Commands.TriggerEnvironmentSelection, file).then(noop, noop);
                    return;
                }
                sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, { trigger: 'run-selection' });
                triggerCreateEnvironmentCheckNonBlocking(CreateEnvironmentCheckKind.File, file);
                await this.executeSelectionInTerminal().then(() => {
                    if (this.shouldTerminalFocusOnStart(file))
                        this.commandManager.executeCommand('workbench.action.terminal.focus');
                });
            }),
        );
        this.disposableRegistry.push(
            this.commandManager.registerCommand(
                Commands.Exec_Selection_In_Django_Shell as any,
                async (file: Resource) => {
                    const interpreterService = this.serviceContainer.get<IInterpreterService>(IInterpreterService);
                    const interpreter = await interpreterService.getActiveInterpreter(file);
                    if (!interpreter) {
                        this.commandManager.executeCommand(Commands.TriggerEnvironmentSelection, file).then(noop, noop);
                        return;
                    }
                    sendTelemetryEvent(EventName.ENVIRONMENT_CHECK_TRIGGER, undefined, { trigger: 'run-selection' });
                    triggerCreateEnvironmentCheckNonBlocking(CreateEnvironmentCheckKind.File, file);
                    await this.executeSelectionInDjangoShell().then(() => {
                        if (this.shouldTerminalFocusOnStart(file))
                            this.commandManager.executeCommand('workbench.action.terminal.focus');
                    });
                },
            ),
        );
    }

    private async executeUsingExtension(file: Resource, dedicated: boolean): Promise<void> {
        const codeExecutionHelper = this.serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        file = file instanceof Uri ? file : undefined;
        let fileToExecute = file ? file : await codeExecutionHelper.getFileToExecute();
        if (!fileToExecute) {
            return;
        }

        const fileAfterSave = await codeExecutionHelper.saveFileIfDirty(fileToExecute);
        if (fileAfterSave) {
            fileToExecute = fileAfterSave;
        }

        // Check on setting terminal.executeInFileDir
        const pythonSettings = this.configSettings.getSettings(file);
        let cwd = pythonSettings.terminal.executeInFileDir ? path.dirname(fileToExecute.fsPath) : undefined;

        // Check on setting terminal.launchArgs
        const launchArgs = pythonSettings.terminal.launchArgs;
        const totalArgs = [...launchArgs, fileToExecute.fsPath.fileToCommandArgumentForPythonExt()];

        const show = this.shouldTerminalFocusOnStart(fileToExecute);
        let terminal: Terminal | undefined;
        if (dedicated) {
            terminal = await runInDedicatedTerminal(fileToExecute, totalArgs, cwd, show);
        } else {
            terminal = await runInTerminal(fileToExecute, totalArgs, cwd, show);
        }

        if (terminal) {
            terminal.show();
        }
    }

    private async executeFileInTerminal(
        file: Resource,
        trigger: 'command' | 'icon',
        options?: { newTerminalPerFile: boolean },
    ): Promise<void> {
        sendTelemetryEvent(EventName.EXECUTION_CODE, undefined, {
            scope: 'file',
            trigger,
            newTerminalPerFile: options?.newTerminalPerFile,
        });
        const codeExecutionHelper = this.serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        file = file instanceof Uri ? file : undefined;
        let fileToExecute = file ? file : await codeExecutionHelper.getFileToExecute();
        if (!fileToExecute) {
            return;
        }
        const fileAfterSave = await codeExecutionHelper.saveFileIfDirty(fileToExecute);
        if (fileAfterSave) {
            fileToExecute = fileAfterSave;
        }

        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'standard');
        await executionService.executeFile(fileToExecute, options);
    }

    @captureTelemetry(EventName.EXECUTION_CODE, { scope: 'selection' }, false)
    private async executeSelectionInTerminal(): Promise<void> {
        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'standard');

        await this.executeSelection(executionService);
    }

    @captureTelemetry(EventName.EXECUTION_DJANGO, { scope: 'selection' }, false)
    private async executeSelectionInDjangoShell(): Promise<void> {
        const executionService = this.serviceContainer.get<ICodeExecutionService>(ICodeExecutionService, 'djangoShell');
        await this.executeSelection(executionService);
    }

    private async executeSelection(executionService: ICodeExecutionService): Promise<void> {
        const activeEditor = this.documentManager.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const codeExecutionHelper = this.serviceContainer.get<ICodeExecutionHelper>(ICodeExecutionHelper);
        const codeToExecute = await codeExecutionHelper.getSelectedTextToExecute(activeEditor);
        let wholeFileContent = '';
        if (activeEditor && activeEditor.document) {
            wholeFileContent = activeEditor.document.getText();
        }
        const normalizedCode = await codeExecutionHelper.normalizeLines(
            codeToExecute!,
            ReplType.terminal,
            wholeFileContent,
        );
        if (!normalizedCode || normalizedCode.trim().length === 0) {
            return;
        }

        try {
            this.eventEmitter.fire(normalizedCode);
        } catch {
            // Ignore any errors that occur for firing this event. It's only used
            // for telemetry
            noop();
        }

        await executionService.execute(normalizedCode, activeEditor.document.uri);
    }

    private shouldTerminalFocusOnStart(uri: Uri | undefined): boolean {
        return this.configSettings.getSettings(uri)?.terminal.focusAfterLaunch;
    }
}
