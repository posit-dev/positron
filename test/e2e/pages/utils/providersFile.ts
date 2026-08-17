/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

/**
 * Reads and writes the AI provider catalog file (`~/.posit/ai/providers.json`)
 * that ai-config resolves and the node catalog watches. Provider enablement
 * lives here now, so tests that toggle a provider on or off write this file
 * rather than a VS Code setting; the running catalog picks the change up live.
 */
export class ProvidersFile {
	private readonly providersPath: string;

	constructor(providersPath: string = ProvidersFile.getProvidersPath()) {
		this.providersPath = providersPath;
	}

	/**
	 * Sets a built-in provider's enabled state, merging into any existing config.
	 */
	public async setEnabled(providerId: string, enabled: boolean): Promise<void> {
		const config = await this.read();
		const providers = (config.providers ??= {});
		const block = (providers[providerId] ??= {});
		block.enabled = enabled;
		await this.write(config);
	}

	public async delete(): Promise<void> {
		try {
			await fs.unlink(this.providersPath);
		} catch {
			// Nothing to remove.
		}
	}

	private async read(): Promise<ProvidersConfig> {
		try {
			const content = await fs.readFile(this.providersPath, 'utf-8');
			return content.trim() ? JSON.parse(content) : {};
		} catch {
			return {};
		}
	}

	private async write(config: ProvidersConfig): Promise<void> {
		await fs.mkdir(path.dirname(this.providersPath), { recursive: true });
		await fs.writeFile(this.providersPath, JSON.stringify(config, null, 2), 'utf-8');
	}

	/**
	 * The catalog file path ai-config reads by default (`~/.posit/ai/providers.json`).
	 */
	static getProvidersPath(): string {
		return path.join(os.homedir(), '.posit', 'ai', 'providers.json');
	}
}

interface ProviderBlock {
	enabled?: boolean;
}

interface ProvidersConfig {
	providers?: Record<string, ProviderBlock>;
}
