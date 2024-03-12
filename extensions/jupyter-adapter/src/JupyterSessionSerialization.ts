/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import { JupyterKernelSpec } from './jupyter-adapter';
import { JupyterSessionState } from './JupyterSession';
import { JUPYTER_WORKSPACE_STATE_KEY } from './extension';

/**
 * The data that needs to be serialized to reconnect to a Jupyter session.
 */
export interface JupyterSerializedSession {
	/** The current dynamic state of the session  */
	dynState: positron.LanguageRuntimeDynState;

	/** The kernel path/arguments, etc. */
	kernelSpec: JupyterKernelSpec;

	/** The information needed to connect to the session */
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
