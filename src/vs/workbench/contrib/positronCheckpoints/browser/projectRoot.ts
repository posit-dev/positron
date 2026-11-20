/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

/**
 * The URI of the engine's project root, with the scheme and authority of the workspace, so that
 * it compares equal to the resources of the editors open in a remote window.
 */
export function projectRootUri(workspaceContextService: IWorkspaceContextService, projectRoot: string): URI {
	const path = URI.file(projectRoot).path;
	const folder = workspaceContextService.getWorkspace().folders[0];
	return folder ? folder.uri.with({ path }) : URI.file(projectRoot);
}
