// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as fs from '../common/platform/fs-paths';
import { inject, injectable } from 'inversify';
import { ConfigurationChangeEvent, ConfigurationTarget, Event, EventEmitter, Uri } from 'vscode';
import { traceError, traceVerbose } from '../logging';
import { IApplicationEnvironment, IWorkspaceService } from './application/types';
import { PythonSettings } from './configSettings';
import { isTestExecution } from './constants';
import { FileSystemPaths } from './platform/fs-paths';
import {
    IDisposable,
    IDisposableRegistry,
    IInterpreterPathService,
    InspectInterpreterSettingType,
    InterpreterConfigurationScope,
    // --- Start Positron ---
    InterpreterPathUpdateOptions,
    // --- End Positron ---
    IPersistentState,
    IPersistentStateFactory,
    IPythonSettings,
    Resource,
} from './types';
import { SystemVariables } from './variables/systemVariables';

export const remoteWorkspaceKeysForWhichTheCopyIsDone_Key = 'remoteWorkspaceKeysForWhichTheCopyIsDone_Key';
export const remoteWorkspaceFolderKeysForWhichTheCopyIsDone_Key = 'remoteWorkspaceFolderKeysForWhichTheCopyIsDone_Key';
export const isRemoteGlobalSettingCopiedKey = 'isRemoteGlobalSettingCopiedKey';
export const defaultInterpreterPathSetting: keyof IPythonSettings = 'defaultInterpreterPath';
// --- Start Positron ---
const globalInterpreterPathKey = 'GLOBAL_INTERPRETER_PATH';
// --- End Positron ---
const CI_PYTHON_PATH = getCIPythonPath();

export function getCIPythonPath(): string {
    if (process.env.CI_PYTHON_PATH && fs.existsSync(process.env.CI_PYTHON_PATH)) {
        return process.env.CI_PYTHON_PATH;
    }
    return 'python';
}
@injectable()
export class InterpreterPathService implements IInterpreterPathService {
    public get onDidChange(): Event<InterpreterConfigurationScope> {
        return this._didChangeInterpreterEmitter.event;
    }
    public _didChangeInterpreterEmitter = new EventEmitter<InterpreterConfigurationScope>();
    private fileSystemPaths: FileSystemPaths;
    // --- Start Positron ---
    // Last-known User-scope python.defaultInterpreterPath value. Used by onDidChangeConfiguration to
    // tell a genuine global setting edit apart from a workspace/workspace-folder edit.
    private lastGlobalDefaultInterpreterPath: string | undefined;
    // --- End Positron ---
    constructor(
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposable[],
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
    ) {
        disposables.push(this.workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)));
        this.fileSystemPaths = FileSystemPaths.withDefaults();
        // --- Start Positron ---
        this.lastGlobalDefaultInterpreterPath = this.readGlobalDefaultInterpreterPath();
        // --- End Positron ---
    }

    public async onDidChangeConfiguration(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration(`python.${defaultInterpreterPathSetting}`)) {
            // --- Start Positron ---
            // inspect() prefers the internal global state over python.defaultInterpreterPath, so a
            // user edit to the global setting would otherwise be shadowed by a value a prior session
            // start persisted (e.g. /old/python keeps resolving). When the User-scope global value
            // changes, clear the internal global state so the edited setting becomes the effective
            // global value; the next session start repopulates it. Without this, the fire below is
            // deduped away because the effective interpreter never changes.
            //
            // affectsConfiguration() is also true for workspace/workspace-folder edits, which must
            // not wipe GLOBAL_INTERPRETER_PATH (it is only written and consumed in the no-workspace
            // case). Comparing the inspected global value before/after isolates a genuine User-scope
            // edit from a project-scoped one, regardless of which window made the change.
            const newGlobalDefaultInterpreterPath = this.readGlobalDefaultInterpreterPath();
            if (newGlobalDefaultInterpreterPath !== this.lastGlobalDefaultInterpreterPath) {
                const persistentGlobal = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
                    this.getGlobalSettingKey(),
                    undefined,
                );
                if (persistentGlobal.value !== undefined) {
                    await persistentGlobal.updateValue(undefined);
                }
                // updateValue() swallows storage failures rather than rejecting, so confirm the
                // clear actually landed by re-reading before advancing the baseline. Otherwise a
                // failed clear would be masked from future config events and the stale interpreter
                // would keep shadowing the edited setting; leaving the baseline unchanged lets a
                // later config event retry.
                if (persistentGlobal.value === undefined) {
                    this.lastGlobalDefaultInterpreterPath = newGlobalDefaultInterpreterPath;
                }
            }
            // This event only fires for real configuration changes: in Positron the extension
            // never writes `python.defaultInterpreterPath` itself (the Global branch of update()
            // below is disabled), so there is no "initial apply" fire at activation to filter out.
            // Treat every fire as session intent. _onConfigChanged dedupes fires that do not
            // change the effective interpreter.
            this._didChangeInterpreterEmitter.fire({
                uri: undefined,
                configTarget: ConfigurationTarget.Global,
                startSession: true,
                source: 'config-change',
            });
            // --- End Positron ---
            traceVerbose('Interpreter Path updated', `python.${defaultInterpreterPathSetting}`);
        }
    }

    public inspect(resource: Resource, useOldKey = false): InspectInterpreterSettingType {
        resource = PythonSettings.getSettingsUriAndTarget(resource, this.workspaceService).uri;
        // --- Start Positron ---
        // Read the internal global persistent state outside the resource check so it applies even
        // when no workspace folder is open. Falls back to python.defaultInterpreterPath.
        const internalGlobalSetting = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
            this.getGlobalSettingKey(useOldKey),
            undefined,
        );
        // --- End Positron ---
        let workspaceFolderSetting: IPersistentState<string | undefined> | undefined;
        let workspaceSetting: IPersistentState<string | undefined> | undefined;
        if (resource) {
            workspaceFolderSetting = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
                this.getSettingKey(resource, ConfigurationTarget.WorkspaceFolder, useOldKey),
                undefined,
            );
            workspaceSetting = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
                this.getSettingKey(resource, ConfigurationTarget.Workspace, useOldKey),
                undefined,
            );
        }
        const defaultInterpreterPath: InspectInterpreterSettingType =
            this.workspaceService.getConfiguration('python', resource)?.inspect<string>('defaultInterpreterPath') ?? {};
        return {
            // --- Start Positron ---
            // globalValue: defaultInterpreterPath.globalValue,
            globalValue:
                internalGlobalSetting.value && internalGlobalSetting.value !== 'python'
                    ? internalGlobalSetting.value
                    : defaultInterpreterPath.globalValue,
            // --- End Positron ---
            workspaceFolderValue:
                !workspaceFolderSetting?.value || workspaceFolderSetting?.value === 'python'
                    ? defaultInterpreterPath.workspaceFolderValue
                    : workspaceFolderSetting.value,
            workspaceValue:
                !workspaceSetting?.value || workspaceSetting?.value === 'python'
                    ? defaultInterpreterPath.workspaceValue
                    : workspaceSetting.value,
        };
    }

    public get(resource: Resource): string {
        const settings = this.inspect(resource);
        const value =
            settings.workspaceFolderValue ||
            settings.workspaceValue ||
            settings.globalValue ||
            (isTestExecution() ? CI_PYTHON_PATH : 'python');
        const systemVariables = new SystemVariables(
            undefined,
            this.workspaceService.getWorkspaceFolder(resource)?.uri.fsPath,
            this.workspaceService,
        );
        return systemVariables.resolveAny(value)!;
    }

    public async update(
        resource: Resource,
        configTarget: ConfigurationTarget,
        pythonPath: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        resource = PythonSettings.getSettingsUriAndTarget(resource, this.workspaceService).uri;
        if (configTarget === ConfigurationTarget.Global) {
            // --- Start Positron ---
            // Store the global active interpreter in internal persistent state, never in settings.json.
            // const pythonConfig = this.workspaceService.getConfiguration('python');
            // const globalValue = pythonConfig.inspect<string>('defaultInterpreterPath')!.globalValue;
            // if (globalValue !== pythonPath) {
            //     await pythonConfig.update('defaultInterpreterPath', pythonPath, true);
            // }
            const persistentGlobal = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
                this.getGlobalSettingKey(),
                undefined,
            );
            if (persistentGlobal.value !== pythonPath) {
                await persistentGlobal.updateValue(pythonPath);
                this._didChangeInterpreterEmitter.fire({
                    uri: undefined,
                    configTarget: ConfigurationTarget.Global,
                    startSession: options?.startSession ?? true,
                    source: options?.source ?? 'unspecified',
                });
            }
            // --- End Positron ---
            return;
        }
        if (!resource) {
            traceError('Cannot update workspace settings as no workspace is opened');
            return;
        }
        const settingKey = this.getSettingKey(resource, configTarget);
        const persistentSetting = this.persistentStateFactory.createGlobalPersistentState<string | undefined>(
            settingKey,
            undefined,
        );
        if (persistentSetting.value !== pythonPath) {
            await persistentSetting.updateValue(pythonPath);
            // --- Start Positron ---
            // Default startSession: true preserves existing upstream semantics when callers don't
            // pass options. Storage-only callers (copyOldInterpreterStorageValuesToNew, Positron
            // session start) must opt out explicitly.
            this._didChangeInterpreterEmitter.fire({
                uri: resource,
                configTarget,
                startSession: options?.startSession ?? true,
                source: options?.source ?? 'unspecified',
            });
            // --- End Positron ---
            traceVerbose('Interpreter Path updated', settingKey, pythonPath);
        }
    }

    // --- Start Positron ---
    public getGlobalSettingKey(useOldKey = false): string {
        const settingKey = globalInterpreterPathKey;
        if (!useOldKey && this.appEnvironment.remoteName) {
            return `${this.appEnvironment.remoteName}_${settingKey}`;
        }
        return settingKey;
    }

    /**
     * Read the User-scope (global) value of python.defaultInterpreterPath, or undefined if unset.
     */
    private readGlobalDefaultInterpreterPath(): string | undefined {
        return this.workspaceService.getConfiguration('python')?.inspect<string>(defaultInterpreterPathSetting)
            ?.globalValue;
    }
    // --- End Positron ---

    public getSettingKey(
        resource: Uri,
        configTarget: ConfigurationTarget.Workspace | ConfigurationTarget.WorkspaceFolder,
        useOldKey = false,
    ): string {
        let settingKey: string;
        const folderKey = this.workspaceService.getWorkspaceFolderIdentifier(resource);
        if (configTarget === ConfigurationTarget.WorkspaceFolder) {
            settingKey = `WORKSPACE_FOLDER_INTERPRETER_PATH_${folderKey}`;
        } else {
            settingKey = this.workspaceService.workspaceFile
                ? `WORKSPACE_INTERPRETER_PATH_${this.fileSystemPaths.normCase(
                    this.workspaceService.workspaceFile.fsPath,
                )}`
                : // Only a single folder is opened, use fsPath of the folder as key
                `WORKSPACE_FOLDER_INTERPRETER_PATH_${folderKey}`;
        }
        if (!useOldKey && this.appEnvironment.remoteName) {
            return `${this.appEnvironment.remoteName}_${settingKey}`;
        }
        return settingKey;
    }

    public async copyOldInterpreterStorageValuesToNew(
        resource: Resource,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        resource = PythonSettings.getSettingsUriAndTarget(resource, this.workspaceService).uri;
        const oldSettings = this.inspect(resource, true);
        // --- Start Positron ---
        // Storage migration should never start a session. Callers can override source if they want
        // a more specific tag; default is 'storage-migration'.
        const migrationOptions: InterpreterPathUpdateOptions = {
            startSession: options?.startSession ?? false,
            source: options?.source ?? 'storage-migration',
        };
        // --- End Positron ---
        await Promise.all([
            // --- Start Positron ---
            // adding migrationOptions to these two
            this._copyWorkspaceFolderValueToNewStorage(resource, oldSettings.workspaceFolderValue, migrationOptions),
            this._copyWorkspaceValueToNewStorage(resource, oldSettings.workspaceValue, migrationOptions),
            // Do not copy python.defaultInterpreterPath into internal global storage; it is a
            // read-only fallback in inspect() only, so live changes to the user's setting are not
            // shadowed by a stale persisted copy. Session start handles the authoritative write.
            //
            // this._moveGlobalSettingValueToNewStorage(oldSettings.globalValue),
            // --- End Positron ---
        ]);
    }

    public async _copyWorkspaceFolderValueToNewStorage(
        resource: Resource,
        value: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        // Copy workspace folder setting into the new storage if it hasn't been copied already
        const workspaceFolderKey = this.workspaceService.getWorkspaceFolderIdentifier(resource, '');
        if (workspaceFolderKey === '') {
            // No workspace folder is opened, simply return.
            return;
        }
        const flaggedWorkspaceFolderKeysStorage = this.persistentStateFactory.createGlobalPersistentState<string[]>(
            remoteWorkspaceFolderKeysForWhichTheCopyIsDone_Key,
            [],
        );
        const flaggedWorkspaceFolderKeys = flaggedWorkspaceFolderKeysStorage.value;
        const shouldUpdateWorkspaceFolderSetting = !flaggedWorkspaceFolderKeys.includes(workspaceFolderKey);
        if (shouldUpdateWorkspaceFolderSetting) {
            // --- Start Positron ---
            await this.update(resource, ConfigurationTarget.WorkspaceFolder, value, options);
            // --- End Positron ---
            await flaggedWorkspaceFolderKeysStorage.updateValue([workspaceFolderKey, ...flaggedWorkspaceFolderKeys]);
        }
    }

    public async _copyWorkspaceValueToNewStorage(
        resource: Resource,
        value: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ): Promise<void> {
        // Copy workspace setting into the new storage if it hasn't been copied already
        const workspaceKey = this.workspaceService.workspaceFile
            ? this.fileSystemPaths.normCase(this.workspaceService.workspaceFile.fsPath)
            : undefined;
        if (!workspaceKey) {
            return;
        }
        const flaggedWorkspaceKeysStorage = this.persistentStateFactory.createGlobalPersistentState<string[]>(
            remoteWorkspaceKeysForWhichTheCopyIsDone_Key,
            [],
        );
        const flaggedWorkspaceKeys = flaggedWorkspaceKeysStorage.value;
        const shouldUpdateWorkspaceSetting = !flaggedWorkspaceKeys.includes(workspaceKey);
        if (shouldUpdateWorkspaceSetting) {
            // --- Start Positron ---
            await this.update(resource, ConfigurationTarget.Workspace, value, options);
            // --- End Positron ---
            await flaggedWorkspaceKeysStorage.updateValue([workspaceKey, ...flaggedWorkspaceKeys]);
        }
    }

    // --- Start Positron ---
    // This method should not be used
    // --- End Positron ---
    public async _moveGlobalSettingValueToNewStorage(value: string | undefined) {
        // Move global setting into the new storage if it hasn't been moved already
        const isGlobalSettingCopiedStorage = this.persistentStateFactory.createGlobalPersistentState<boolean>(
            isRemoteGlobalSettingCopiedKey,
            false,
        );
        const shouldUpdateGlobalSetting = !isGlobalSettingCopiedStorage.value;
        if (shouldUpdateGlobalSetting) {
            await this.update(undefined, ConfigurationTarget.Global, value);
            await isGlobalSettingCopiedStorage.updateValue(true);
        }
    }
}
