/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import { JupyterAdapterApi, JupyterKernelExtra, JupyterKernelSpec, JupyterLanguageRuntimeSession } from './jupyter-adapter';


/**
 * The Kallichore Adapter API as exposed by the Kallichore Adapter extension.
 */
export interface KallichoreAdapterApi extends JupyterAdapterApi {

	/**
	 * Create a session for a Jupyter-compatible kernel.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to be
	 * wrapped by the adapter.
	 * @param sessionMetadata The metadata for the session to be created.
	 * @param kernel A Jupyter kernel spec containing the information needed to
	 *   start the kernel.
	 * @param dynState The initial dynamic state of the session.
	 * @param extra Optional implementations for extra functionality.
	 *
	 * @returns A JupyterLanguageRuntimeSession that wraps the kernel.
	 */
	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		kernel: JupyterKernelSpec,
		dynState: positron.LanguageRuntimeDynState,
		extra?: JupyterKernelExtra | undefined,
	): JupyterLanguageRuntimeSession;

	/**
	 * Restore a session for a Jupyter-compatible kernel.
	 *
	 * @param runtimeMetadata The metadata for the language runtime to be
	 * wrapped by the adapter.
	 * @param sessionMetadata The metadata for the session to be reconnected.
	 *
	 * @returns A JupyterLanguageRuntimeSession that wraps the kernel.
	 */
	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata
	): JupyterLanguageRuntimeSession
}
