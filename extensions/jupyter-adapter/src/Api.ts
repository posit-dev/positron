/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterAdapterApi, JupyterKernelSpec, JupyterKernelExtra, JupyterLanguageRuntimeSession } from './jupyter-adapter';

import { LanguageRuntimeSessionAdapter } from './LanguageRuntimeAdapter';
import { findAvailablePort } from './PortFinder';

export class JupyterAdapterApiImpl implements JupyterAdapterApi {
	constructor(private readonly _context: vscode.ExtensionContext,
		private readonly _channel: vscode.OutputChannel) {
	}

	/**
	 * Create a session for a Jupyter-compatible kernel.
	 *
	 * @param sessionId A unique identifier for the session.
	 * @param kernel A Jupyter kernel spec containing the information needed to
	 *   start the kernel.
	 * @param metadata The metadata for the language runtime to be wrapped by the
	 *   adapter.
	 * @param extra Optional implementations for extra functionality.
	 * @returns A LanguageRuntimeAdapter that wraps the kernel.
	 */
	createSession(
		sessionId: string,
		kernel: JupyterKernelSpec,
		metadata: positron.LanguageRuntimeMetadata,
		dynState: positron.LanguageRuntimeDynState,
		extra: JupyterKernelExtra,
	): JupyterLanguageRuntimeSession {
		return new LanguageRuntimeSessionAdapter(
			sessionId,
			this._context,
			this._channel,
			kernel,
			metadata,
			dynState,
			extra
		);
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
