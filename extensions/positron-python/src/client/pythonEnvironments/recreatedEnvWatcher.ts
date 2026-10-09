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
 * How long to watch for a removed env to come back.
 */
export const RECREATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Watches for removed workspace envs to come back, e.g. `.venv` deleted and recreated.
 * On Linux the file watcher only reports the new `.venv` folder, not the files created
 * inside it, so the workspace executable watcher never sees the new executable. For each
 * removed env, this watches every folder between the workspace and the executable, and
 * looks the executable up once one of them is created. Not every removed env comes back,
 * so it stops watching an env after `RECREATE_TIMEOUT_MS`.
 */
export class RecreatedEnvWatcher implements Disposable {
    private readonly _watchers = new Map<string, { workspaceFolder: WorkspaceFolder; stop: () => void }>();

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
            clearTimeout(timeout);
            watchers.forEach((d) => d.dispose());
            this._watchers.delete(executable);
        };
        const timeout = setTimeout(() => {
            stop();
            traceVerbose(`[RecreatedEnvWatcher] Stopped watching for ${executable} to be recreated`);
        }, RECREATE_TIMEOUT_MS);
        let checking = false;
        let queuedAttempts = 0;
        // Looks the executable up, up to `attempts` times 200ms apart. The executable can lag
        // its folder by a moment while the venv is written, and PET can fail on a half-written
        // venv, so the watchers stay until the env is added and a later folder creation tries
        // again. A folder created while a check is running queues one more check rather than
        // being dropped.
        const check = async (attempts: number): Promise<void> => {
            if (checking) {
                queuedAttempts = Math.max(queuedAttempts, attempts);
                return;
            }
            checking = true;
            try {
                let remaining = attempts;
                while (remaining > 0) {
                    for (let attempt = 0; attempt < remaining; attempt += 1) {
                        if (attempt > 0) {
                            await sleep(200);
                        }
                        if (
                            (await pathExists(executable)) &&
                            (await this.addRecreatedEnv(executable, workspaceFolder))
                        ) {
                            stop();
                            traceVerbose(`[RecreatedEnvWatcher] ${executable} was recreated`);
                            return;
                        }
                    }
                    remaining = queuedAttempts;
                    queuedAttempts = 0;
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
            watchers.push(
                watcher,
                watcher.onDidCreate(() => check(10)),
            );
            dir = path.dirname(dir);
        }
        this._watchers.set(executable, { workspaceFolder, stop });

        // The env may already be back: a delete and recreate reported together leave no
        // folder creation to wait for.
        check(1).catch(() => undefined);
    }

    /**
     * Stop watching for the removed envs of a workspace folder that was removed.
     */
    unwatchFolder(workspaceFolder: WorkspaceFolder): void {
        [...this._watchers.values()]
            .filter((entry) => arePathsSame(entry.workspaceFolder.uri.fsPath, workspaceFolder.uri.fsPath))
            .forEach((entry) => entry.stop());
    }

    dispose(): void {
        [...this._watchers.values()].forEach((entry) => entry.stop());
    }
}
