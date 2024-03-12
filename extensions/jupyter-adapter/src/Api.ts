/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterKernelExtra, JupyterLanguageRuntimeSession } from './jupyter-adapter';

import { LanguageRuntimeSessionAdapter } from './LanguageRuntimeAdapter';
import { findAvailablePort } from './PortFinder';
import { JupyterSerializedSession, workspaceStateKey } from './JupyterSessionSerialization';

export class JupyterAdapterApiImpl implements JupyterAdapterApi {
	constructor(private readonly _context: vscode.ExtensionContext,
		private readonly _channel: vscode.OutputChannel) {
	}

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
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata,
		kernel: JupyterKernelSpec,
		dynState: positron.LanguageRuntimeDynState,
		extra: JupyterKernelExtra,
	): JupyterLanguageRuntimeSession {
		return new LanguageRuntimeSessionAdapter(
			runtimeMetadata,
			sessionMetadata,
			this._context,
			this._channel,
			kernel,
			dynState,
			extra
		);
	}

	/**
	 * Restore (reconnect to) a running session for a Jupyter-compatible kernel.
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
	): JupyterLanguageRuntimeSession {

		// Get the serialized session from the workspace state. This state
		// contains the information we need to reconnect to the session, such as
		// the path of the connection JSON file that names the ZeroMQ ports for
		// each socket.
		const state = this._context.workspaceState.get(
			workspaceStateKey(runtimeMetadata, sessionMetadata));
		if (!state) {
			throw new Error(
				`No state found for session '${sessionMetadata.sessionId}' ` +
				`of runtime ${runtimeMetadata.runtimeName}`);
		}
		const serialized = state as JupyterSerializedSession;

		// Create the adapter
		const adapter = new LanguageRuntimeSessionAdapter(
			runtimeMetadata,
			sessionMetadata,
			this._context,
			this._channel,
			serialized.kernelSpec,
			serialized.dynState);

		// Write the session state to the adapter; this will cause it to
		// reconnect to the existing session state when it starts up.
		//
		// Note that this does *not* immediately reconnect to the session; that
		// happens later when the session is started.
		adapter.restoreSession(serialized.sessionState);

		return adapter;
	}

	/**
	 * Finds an available TCP port for a server
	 *
	 * @param excluding A list of ports to exclude from the search
	 * @param maxTries The maximum number of attempts
	 * @returns An available TCP port
	 */
	findAvailablePort(excluding: number[], maxTries: number): Promise<number> {
		return findAvailablePort(excluding, maxTries);
	}

	dispose() {
	}
}
