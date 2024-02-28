/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { rRuntimeDiscoverer } from './provider';
import { RMetadataExtra } from './r-installation';
import { RSession, createJupyterKernelExtra, createJupyterKernelSpec } from './session';

export class RRuntimeManager implements positron.LanguageRuntimeManager {

	constructor(private readonly _context: vscode.ExtensionContext) { }

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		return rRuntimeDiscoverer(this._context);
	}

	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {

		// When creating a session, we need to create a kernel spec and extra
		// data
		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelExtra = createJupyterKernelExtra();
		const kernelSpec = createJupyterKernelSpec(this._context,
			metadataExtra.homepath,
			runtimeMetadata.runtimeName);
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			this._context,
			kernelSpec,
			kernelExtra);

		return Promise.resolve(session);
	}

	restoreSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {

		// When restoring an existing session, the kernelspec is stored.
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			this._context);

		return Promise.resolve(session);
	}
}
