/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { initProviderCatalog } from '../providerCatalog';

interface ValidationCatalogFixture {
	dispose(): Promise<void>;
}

/** Minimal ExtensionContext stub: only `subscriptions` is read by initProviderCatalog. */
function fakeContext(): vscode.ExtensionContext {
	return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

export async function initializeValidationCatalog(
	providers: Record<string, unknown>
): Promise<ValidationCatalogFixture> {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-headers-'));
	const configPath = path.join(directory, 'providers.json');
	fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers }));

	const context = fakeContext();
	await initProviderCatalog(context, { configPath });

	return {
		async dispose() {
			for (const disposable of context.subscriptions) {
				disposable.dispose();
			}

			fs.writeFileSync(configPath, JSON.stringify({ version: 1, providers: {} }));
			const resetContext = fakeContext();
			await initProviderCatalog(resetContext, { configPath });
			for (const disposable of resetContext.subscriptions) {
				disposable.dispose();
			}
			fs.rmSync(directory, { recursive: true, force: true });
		},
	};
}
