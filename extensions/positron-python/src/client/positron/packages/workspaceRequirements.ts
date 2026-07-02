/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { IWorkspaceService } from '../../common/application/types';
import { IFileSystem } from '../../common/platform/types';

/**
 * Locate the workspace-root `requirements.txt`, if present. When it exists,
 * package operations treat it as the source of truth (passed verbatim via
 * `-r`); when absent, callers fall back to the `pip freeze` path. Only the
 * first workspace folder is considered (multi-root is out of scope).
 */
export async function findWorkspaceRequirementsFile(
    workspaceService: IWorkspaceService,
    fileSystem: IFileSystem,
): Promise<string | undefined> {
    const workspaceFolder = workspaceService.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return undefined;
    }
    const requirementsPath = path.join(workspaceFolder.uri.fsPath, 'requirements.txt');
    return (await fileSystem.fileExists(requirementsPath)) ? requirementsPath : undefined;
}
