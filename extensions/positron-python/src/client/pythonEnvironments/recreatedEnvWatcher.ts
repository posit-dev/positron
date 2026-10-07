/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { Disposable, RelativePattern, WorkspaceFolder } from 'vscode';
import { sleep } from '../common/utils/async';
import { createFileSystemWatcher } from '../common/vscodeApis/workspaceApis';
import { traceVerbose } from '../logging';
import { arePathsSame, isParentPath, pathExists } from './common/externalDependencies';

/**
 * Watches for removed workspace envs to come back, e.g. `.venv` deleted and recreated.
 * On Linux the file watcher only reports the new `.venv` folder, not the files created
 * inside it, so the workspace executable watcher never sees the new executable. For each
 * removed env, this watches every folder between the workspace and the executable, and
 * looks the executable up once one of them is created.
 */
export class RecreatedEnvWatcher implements Disposable {
    private readonly _watchers = new Map<string, Disposable>();

    /**
     * @param addRecreatedEnv Looks the executable up and adds its env. Resolves true once
     * the env is added.
     */
    constructor(
        private readonly addRecreatedEnv: (executable: string, workspaceFolder: WorkspaceFolder) => Promise<boolean>,
    ) {}

    /**
     * Start watching for a removed env's executable to come back.
     */
    watch(executable: string, workspaceFolder: WorkspaceFolder): void {
        if (this._watchers.has(executable)) {
            return;
        }

        const watchers: Disposable[] = [];
        const stop = () => {
            watchers.forEach((d) => d.dispose());
            this._watchers.delete(executable);
        };
        let checking = false;
        const onFolderCreated = async () => {
            if (checking) {
                return;
            }
            checking = true;
            try {
                // The executable can lag its folder by a moment while the venv is written,
                // and PET can fail on a half-written venv. Keep the watchers until the env is
                // added, so a later folder creation tries again.
                for (let attempt = 0; attempt < 10; attempt += 1) {
                    if ((await pathExists(executable)) && (await this.addRecreatedEnv(executable, workspaceFolder))) {
                        stop();
                        traceVerbose(`[RecreatedEnvWatcher] ${executable} was recreated`);
                        return;
                    }
                    await sleep(200);
                }
            } finally {
                checking = false;
            }
        };

        const root = workspaceFolder.uri.fsPath;
        let dir = path.dirname(executable);
        while (isParentPath(dir, root) && !arePathsSame(dir, root)) {
            const watcher = createFileSystemWatcher(
                new RelativePattern(path.dirname(dir), path.basename(dir)),
                false,
                true,
                true,
            );
            watchers.push(watcher, watcher.onDidCreate(onFolderCreated));
            dir = path.dirname(dir);
        }
        this._watchers.set(executable, { dispose: stop });
    }

    dispose(): void {
        [...this._watchers.values()].forEach((d) => d.dispose());
    }
}
