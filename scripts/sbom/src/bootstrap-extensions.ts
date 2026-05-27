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
 * Detect project type by checking for Cargo.toml (Rust) or package.json (npm)
 * For subdirectory repos, check the subdirectory
 */
function detectProjectType(extensionPath: string): 'npm' | 'rust' {
	const fullPath = resolvePath(getRepoRoot(), extensionPath);

	// Check if this is a subdirectory repo (has .sbom-subdir marker)
	const subdirMarker = resolvePath(fullPath, '.sbom-subdir');
	let checkPath = fullPath;

	if (existsSync(subdirMarker)) {
		const subdir = readFileSync(subdirMarker, 'utf-8').trim();
		checkPath = resolvePath(fullPath, subdir);
	}

	// Check for Cargo.toml first (Rust)
	if (existsSync(resolvePath(checkPath, 'Cargo.toml'))) {
		return 'rust';
	}

	// Default to npm (package.json is checked later during SBOM generation)
	return 'npm';
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
			.map(ext => {
				const basePath = `.sbom-tmp/bootstrap-extensions/${ext.name}`;
				const type = detectProjectType(basePath);

				// Check if this is a subdirectory repo
				const subdirMarker = resolvePath(getRepoRoot(), basePath, '.sbom-subdir');
				let scanPath = basePath;

				if (existsSync(subdirMarker)) {
					const subdir = readFileSync(subdirMarker, 'utf-8').trim();
					scanPath = `${basePath}/${subdir}`;
				}

				return {
					name: `Bootstrap: ${ext.name}`,
					path: scanPath,
					type
				};
			});

		const rustCount = projects.filter(p => p.type === 'rust').length;
		const npmCount = projects.filter(p => p.type === 'npm').length;

		console.log(`Found ${projects.length} bootstrap extensions with repositories (${npmCount} npm, ${rustCount} rust)`);
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
