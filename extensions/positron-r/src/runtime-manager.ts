/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { findCurrentRBinary, rRuntimeDiscoverer } from './provider';
import { RInstallation, RMetadataExtra } from './r-installation';
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
			runtimeMetadata.runtimeName,
			sessionMetadata.sessionMode);
		const session = new RSession(runtimeMetadata,
			sessionMetadata,
			this._context,
			kernelSpec,
			kernelExtra);

		return Promise.resolve(session);
	}

	async validateMetadata(metadata: positron.LanguageRuntimeMetadata): Promise<positron.LanguageRuntimeMetadata> {
		const metadataExtra = metadata.extraRuntimeData as RMetadataExtra;

		// Validate that the metadata has the extra data we need
		if (!metadataExtra) {
			throw new Error('R metadata is missing binary path');
		}

		// Validate that the metadata has R's home path and bin path
		if (!metadataExtra.homepath) {
			throw new Error('R metadata is missing home path');
		}
		if (!metadataExtra.binpath) {
			throw new Error('R metadata is missing bin path');
		}

		// Look for the current R binary. Note that this can return undefined,
		// if there are no current/default R installations on the system. This
		// is okay.
		const curBin = await findCurrentRBinary();

		// Create an RInstallation object with the metadata's binary path.
		const inst = new RInstallation(metadataExtra.binpath,
			curBin === metadataExtra.binpath);

		// Check the installation for validity
		if (!inst.valid) {

			// Consider future improvements:
			//
			// We could name the specific reason the installation is invalid, if
			// only for logging purposes.
			//
			// It'd be helpful to select and return a valid installation if it's
			// available and reasonably compatible with the installation we were
			// asked for. This is probably going to be common for cases wherein
			// R is upgraded in place.
			throw new Error(`R installation at ${metadataExtra.binpath} is not usable.`);
		}

		// Looks like a valid R installation.
		return Promise.resolve(metadata);
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
