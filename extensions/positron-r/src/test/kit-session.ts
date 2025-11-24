/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { RSession } from '../session';
import { delay } from '../util';
import { toDisposable } from './kit-disposables';
import { ArkLsp } from '../lsp';

export async function startR(): Promise<[RSession, vscode.Disposable, ArkLsp]> {
	// There doesn't seem to be a method that resolves when a language is
	// both discovered and ready to be started
	let info: positron.LanguageRuntimeMetadata;

	const startTime = Date.now();
	const timeout = 30000;

	while (true) {
		try {
			info = await positron.runtime.getPreferredRuntime('r');
			if (info) {
				break;
			}
		} catch (_) {
			// Try again
		}

		if (Date.now() - startTime > timeout) {
			throw new Error('Timeout while waiting for preferred R runtime');
		}
		await delay(50);
	}

	const session = await positron.runtime.startLanguageRuntime(info!.runtimeId, 'Tests') as RSession;
	positron.runtime.focusSession(session.metadata.sessionId);

	const lspReady = session.waitLsp();
	const lspTimeout = (async () => {
		await delay(5000);
	})();

	const lsp = await Promise.race([lspReady, lspTimeout]);
	if (!lsp) {
		throw new Error('Timeout while waiting for LSP to be ready');
	}

	const disposable = toDisposable(async () => {
		// This avoids RPC errors in Positron clients when session is disposed too soon:
		// https://github.com/posit-dev/positron/blob/a6c2109d/src/vs/workbench/api/browser/positron/mainThreadLanguageRuntime.ts#L1351-L1355
		// Can we (should we?) finish ongoing RPCs with a timeout on shutdown, in a
		// way that's synchronised with the runtime cleanup?
		await delay(300);

		const deleted = await positron.runtime.deleteSession(session.metadata.sessionId);
		if (!deleted) {
			throw new Error(`Can't delete session ${session.metadata.sessionId}`);
		}
	});

	return [session, disposable, lsp];
}

/**
 * Executes R code using `positron.runtime.executeCode`.
 * Doesn't take focus and incomplete statements are not allowed.
 * @param src The R code to execute.
 */
export async function execute(src: string) {
	await positron.runtime.executeCode('r', src, false, false);
}
