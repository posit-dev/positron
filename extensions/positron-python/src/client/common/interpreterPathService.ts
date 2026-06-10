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
    constructor(
        @inject(IPersistentStateFactory) private readonly persistentStateFactory: IPersistentStateFactory,
        @inject(IWorkspaceService) private readonly workspaceService: IWorkspaceService,
        @inject(IDisposableRegistry) disposables: IDisposable[],
        @inject(IApplicationEnvironment) private readonly appEnvironment: IApplicationEnvironment,
    ) {
        disposables.push(this.workspaceService.onDidChangeConfiguration(this.onDidChangeConfiguration.bind(this)));
        this.fileSystemPaths = FileSystemPaths.withDefaults();
    }

    public async onDidChangeConfiguration(event: ConfigurationChangeEvent) {
        if (event.affectsConfiguration(`python.${defaultInterpreterPathSetting}`)) {
            // --- Start Positron ---
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
            globalValue: defaultInterpreterPath.globalValue,
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
            // do not update global interpreter path setting via the Select Interpreter dropdown
            // const pythonConfig = this.workspaceService.getConfiguration('python');
            // const globalValue = pythonConfig.inspect<string>('defaultInterpreterPath')!.globalValue;
            // if (globalValue !== pythonPath) {
            //     await pythonConfig.update('defaultInterpreterPath', pythonPath, true);
            // }
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
            this._copyWorkspaceFolderValueToNewStorage(resource, oldSettings.workspaceFolderValue, migrationOptions),
            this._copyWorkspaceValueToNewStorage(resource, oldSettings.workspaceValue, migrationOptions),
            this._moveGlobalSettingValueToNewStorage(oldSettings.globalValue, migrationOptions),
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

    public async _moveGlobalSettingValueToNewStorage(
        value: string | undefined,
        // --- Start Positron ---
        options?: InterpreterPathUpdateOptions,
        // --- End Positron ---
    ) {
        // Move global setting into the new storage if it hasn't been moved already
        const isGlobalSettingCopiedStorage = this.persistentStateFactory.createGlobalPersistentState<boolean>(
            isRemoteGlobalSettingCopiedKey,
            false,
        );
        const shouldUpdateGlobalSetting = !isGlobalSettingCopiedStorage.value;
        if (shouldUpdateGlobalSetting) {
            // --- Start Positron ---
            await this.update(undefined, ConfigurationTarget.Global, value, options);
            // --- End Positron ---
            await isGlobalSettingCopiedStorage.updateValue(true);
        }
    }
}
