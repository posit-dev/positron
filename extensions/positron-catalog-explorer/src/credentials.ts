/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface DatabricksCredentialProvider {
	getToken(workspace: string): Promise<string | undefined>;
}

/**
 * A basic credential provider that delegates to the extension's secret storage
 * for a Databricks PAT, with some basic in-memory caching.
 */
export class DefaultDatabricksCredentialProvider
	implements DatabricksCredentialProvider
{
	private cache = new Map<string, string>();

	constructor(private store: vscode.SecretStorage) {
		this.store.onDidChange(async (e) => {
			if (!this.cache.has(e.key)) {
				return;
			}
			const newValue = await this.store.get(e.key);
			this.cache.set(e.key, newValue ?? '');
		});
	}

	async getToken(workspace: string): Promise<string | undefined> {
		const key = workspace.startsWith('https://')
			? workspace
			: `https://${workspace}`;
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}
		const value = await this.store.get(key);
		if (value) {
			this.cache.set(key, value);
		}
		return value;
	}
}
