/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { findCurrentRBinary, makeMetadata, rRuntimeDiscoverer } from './provider';
import { RInstallation, RMetadataExtra } from './r-installation';
import { RSession, createJupyterKernelExtra, createJupyterKernelSpec } from './session';

export class RRuntimeManager implements positron.LanguageRuntimeManager {

	constructor(private readonly _context: vscode.ExtensionContext) { }

	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata> {
		return rRuntimeDiscoverer();
	}

	createSession(
		runtimeMetadata: positron.LanguageRuntimeMetadata,
		sessionMetadata: positron.RuntimeSessionMetadata): Thenable<positron.LanguageRuntimeSession> {

		// When creating a session, we need to create a kernel spec and extra
		// data
		const metadataExtra = runtimeMetadata.extraRuntimeData as RMetadataExtra;
		const kernelExtra = createJupyterKernelExtra();
		const kernelSpec = createJupyterKernelSpec(
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

		// Validate that the metadata has all of the extra data we need
		if (!metadataExtra) {
			throw new Error('R metadata is missing binary path');
		}
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

		let inst: RInstallation;
		if (curBin && metadataExtra.current) {
			// If the metadata says that it represents the "current" version of R, interpret that to
			// mean the current "current" version of R, at this very moment, not whatever it was
			// when this metadata was stored.
			// The motivation for this mindset is immediate launch of an affiliated runtime.
			// More thoughts in this issue:
			// https://github.com/posit-dev/positron/issues/2659
			inst = new RInstallation(curBin, true);
		} else {
			inst = new RInstallation(metadataExtra.binpath, curBin === metadataExtra.binpath);
		}

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
		return Promise.resolve(makeMetadata(inst, positron.LanguageRuntimeStartupBehavior.Immediate));
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
