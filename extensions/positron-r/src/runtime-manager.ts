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
		sessionId: string,
		sessionName: string,
		sessionMode: positron.LanguageRuntimeSessionMode): Thenable<positron.LanguageRuntimeSession> {

		const metadataExtra = runtimeMetadata.extraData as RMetadataExtra;
		const kernelExtra = createJupyterKernelExtra();

		const kernelSpec = createJupyterKernelSpec(this._context,
			metadataExtra.homepath,
			runtimeMetadata.runtimeName);
		const dynState: positron.LanguageRuntimeDynState = {
			continuationPrompt: '+',
			inputPrompt: '>',
		};

		const session = new RSession(sessionId,
			sessionName,
			sessionMode,
			this._context,
			kernelSpec,
			runtimeMetadata,
			dynState,
			kernelExtra);

		return Promise.resolve(session);
	}
}
