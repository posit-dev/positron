/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { JupyterKernelSpec } from './jupyter-adapter';
import { JupyterSessionState } from './JupyterSession';
import { JUPYTER_WORKSPACE_STATE_KEY } from './extension';

export interface JupyterSerializedSession {
	dynState: positron.LanguageRuntimeDynState;
	kernelSpec: JupyterKernelSpec;
	sessionState: JupyterSessionState;
}

/**
 * Generate a storage key for a Jupyter session.
 *
 * @param runtimeMetadata The metadata for the language runtime
 * @param sessionMetadata The metadata for the session
 *
 * @returns A unique key for the session.
 */
export function workspaceStateKey(
	runtimeMetadata: positron.LanguageRuntimeMetadata,
	sessionMetadata: positron.RuntimeSessionMetadata): string {
	return [JUPYTER_WORKSPACE_STATE_KEY,
		runtimeMetadata.runtimeId,
		sessionMetadata.sessionId].join('.');
}
