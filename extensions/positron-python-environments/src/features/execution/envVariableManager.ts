import * as fsapi from 'fs-extra';
import * as path from 'path';
import { Event, EventEmitter, FileChangeType, Uri } from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import { DidChangeEnvironmentVariablesEventArgs, PythonEnvironmentVariablesApi } from '../../api';
import { resolveVariables } from '../../common/utils/internalVariables';
import { createFileSystemWatcher, getConfiguration } from '../../common/workspace.apis';
import { PythonProjectManager } from '../../internal.api';
import { mergeEnvVariables, parseEnvFile } from './envVarUtils';

export interface EnvVarManager extends PythonEnvironmentVariablesApi, Disposable {}

export class PythonEnvVariableManager implements EnvVarManager {
    private disposables: Disposable[] = [];

    private _onDidChangeEnvironmentVariables;
    private watcher;

    constructor(private pm: PythonProjectManager) {
        this._onDidChangeEnvironmentVariables = new EventEmitter<DidChangeEnvironmentVariablesEventArgs>();
        this.onDidChangeEnvironmentVariables = this._onDidChangeEnvironmentVariables.event;

        this.watcher = createFileSystemWatcher('**/.env');
        this.disposables.push(
            this._onDidChangeEnvironmentVariables,
            this.watcher,
            this.watcher.onDidCreate((e) =>
                this._onDidChangeEnvironmentVariables.fire({ uri: e, changeType: FileChangeType.Created }),
            ),
            this.watcher.onDidChange((e) =>
                this._onDidChangeEnvironmentVariables.fire({ uri: e, changeType: FileChangeType.Changed }),
            ),
            this.watcher.onDidDelete((e) =>
                this._onDidChangeEnvironmentVariables.fire({ uri: e, changeType: FileChangeType.Deleted }),
            ),
        );
    }

    async getEnvironmentVariables(
        uri: Uri | undefined,
        overrides?: ({ [key: string]: string | undefined } | Uri)[],
        baseEnvVar?: { [key: string]: string | undefined },
    ): Promise<{ [key: string]: string | undefined }> {
        const project = uri ? this.pm.get(uri) : undefined;

        const base = baseEnvVar || { ...process.env };
        let env = base;

        const config = getConfiguration('python', project?.uri ?? uri);
        let envFilePath = config.get<string>('envFile');
        envFilePath = envFilePath ? path.normalize(resolveVariables(envFilePath, uri)) : undefined;

        if (envFilePath && (await fsapi.pathExists(envFilePath))) {
            const other = await parseEnvFile(Uri.file(envFilePath));
            env = mergeEnvVariables(env, other);
        }

        let projectEnvFilePath = project ? path.normalize(path.join(project.uri.fsPath, '.env')) : undefined;
        if (
            projectEnvFilePath &&
            projectEnvFilePath?.toLowerCase() !== envFilePath?.toLowerCase() &&
            (await fsapi.pathExists(projectEnvFilePath))
        ) {
            const other = await parseEnvFile(Uri.file(projectEnvFilePath));
            env = mergeEnvVariables(env, other);
        }

        if (overrides) {
            for (const override of overrides) {
                const other = override instanceof Uri ? await parseEnvFile(override) : override;
                env = mergeEnvVariables(env, other);
            }
        }

        return env;
    }

    onDidChangeEnvironmentVariables: Event<DidChangeEnvironmentVariablesEventArgs>;

    dispose(): void {
        this.disposables.forEach((disposable) => disposable.dispose());
    }
}
