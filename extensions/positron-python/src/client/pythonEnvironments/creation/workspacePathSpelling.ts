/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';

/**
 * Rewrites a path under the symlink-resolved workspace folder so that it uses the workspace
 * folder's own spelling. Creation scripts run with the workspace as cwd and build paths from
 * the resolved cwd (for example /private/var/... on macOS when the workspace is /var/...).
 * The file watcher reports the same environment under the workspace spelling, so without this
 * the environment is registered twice with different runtime ids.
 *
 * Returns the path unchanged if it is not under the resolved workspace folder, if the
 * workspace path has no symlinks, or if the workspace path cannot be resolved.
 */
export function toWorkspacePathSpelling(envPath: string, workspacePath: string): string {
    let resolvedWorkspace: string;
    try {
        resolvedWorkspace = fs.realpathSync(workspacePath);
    } catch {
        return envPath;
    }
    if (resolvedWorkspace === workspacePath) {
        return envPath;
    }
    const relative = path.relative(resolvedWorkspace, envPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return envPath;
    }
    return path.join(workspacePath, relative);
}
