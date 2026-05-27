/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, existsSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { Project } from './types';
import { getRepoRoot } from './utils';

export interface BootstrapExtension {
	name: string;
	version: string;
	repo?: string;
	[key: string]: any;
}

/**
 * Read bootstrap extensions from product.json
 */
export function getBootstrapExtensions(): Project[] {
	const productJsonPath = resolvePath(getRepoRoot(), 'product.json');

	if (!existsSync(productJsonPath)) {
		console.warn('product.json not found, skipping bootstrap extensions');
		return [];
	}

	try {
		const productJson = JSON.parse(readFileSync(productJsonPath, 'utf-8'));
		const extensions: BootstrapExtension[] = productJson.bootstrapExtensions || [];

		// Filter to only extensions with repos, and create project definitions
		const projects: Project[] = extensions
			.filter(ext => ext.repo)
			.map(ext => ({
				name: `Bootstrap: ${ext.name}`,
				path: `.sbom-tmp/bootstrap-extensions/${ext.name}`,
				type: 'npm' as const
			}));

		console.log(`Found ${projects.length} bootstrap extensions with repositories`);
		return projects;
	} catch (error) {
		console.warn(`Failed to parse product.json: ${error}`);
		return [];
	}
}

/**
 * Get the list of extension names and repos for cloning
 */
export function getBootstrapExtensionRepos(): Array<{ name: string; repo: string }> {
	const productJsonPath = resolvePath(getRepoRoot(), 'product.json');

	if (!existsSync(productJsonPath)) {
		return [];
	}

	try {
		const productJson = JSON.parse(readFileSync(productJsonPath, 'utf-8'));
		const extensions: BootstrapExtension[] = productJson.bootstrapExtensions || [];

		return extensions
			.filter(ext => ext.repo)
			.map(ext => ({
				name: ext.name,
				repo: ext.repo!
			}));
	} catch (error) {
		console.warn(`Failed to parse product.json: ${error}`);
		return [];
	}
}
