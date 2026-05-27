/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'crypto';
import { resolve as resolvePath } from 'path';
import { existsSync, readFileSync } from 'fs';
import { BOM, Component, Metadata } from './types';

/**
 * Get the root path of the repository
 */
export function getRepoRoot(): string {
	// This script lives in scripts/sbom/src/, so go up 3 levels
	return resolvePath(__dirname, '../../..');
}

/**
 * Get Positron version from package.json
 */
export function getPositronVersion(): string {
	const packageJsonPath = resolvePath(getRepoRoot(), 'package.json');
	if (!existsSync(packageJsonPath)) {
		console.warn('package.json not found, using "dev" version');
		return 'dev';
	}

	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		return packageJson.version || 'dev';
	} catch (error) {
		console.warn(`Failed to parse package.json: ${error}`);
		return 'dev';
	}
}

/**
 * Create an empty CycloneDX BOM
 */
export function createEmptyBom(): BOM {
	const version = getPositronVersion();

	return {
		bomFormat: 'CycloneDX',
		specVersion: '1.4',
		serialNumber: `urn:uuid:${randomUUID()}`,
		version: 1,
		metadata: {
			timestamp: new Date().toISOString(),
			tools: [
				{
					vendor: 'Snyk',
					name: 'snyk-cli'
				},
				{
					vendor: 'cargo',
					name: 'cargo-cyclonedx'
				}
			],
			component: {
				'bom-ref': `positron@${version}`,
				type: 'application',
				name: 'Positron',
				version: version,
				description: 'Next-generation data science IDE'
			}
		},
		components: [],
		dependencies: []
	};
}

/**
 * Check if Snyk CLI is installed
 */
export async function checkForSnyk(): Promise<void> {
	const { spawn } = await import('child_process');

	return new Promise((resolve, reject) => {
		const proc = spawn('snyk', ['--version']);
		let found = false;

		proc.on('close', (code) => {
			if (code === 0 || found) {
				resolve();
			} else {
				reject(new Error('Snyk CLI not found. Please install with: npm install -g snyk'));
			}
		});

		proc.stdout.on('data', () => {
			found = true;
		});

		proc.on('error', () => {
			reject(new Error('Snyk CLI not found. Please install with: npm install -g snyk'));
		});
	});
}

/**
 * Check if cargo-cyclonedx is installed
 */
export async function checkForCargoCyclonedx(): Promise<void> {
	const { spawn } = await import('child_process');

	return new Promise((resolve, reject) => {
		const proc = spawn('cargo', ['cyclonedx', '--version']);
		let found = false;

		proc.on('close', (code) => {
			if (code === 0 || found) {
				resolve();
			} else {
				reject(new Error('cargo-cyclonedx not found. Please install with: cargo install cargo-cyclonedx'));
			}
		});

		proc.stdout.on('data', () => {
			found = true;
		});

		proc.on('error', () => {
			reject(new Error('cargo-cyclonedx not found. Please install with: cargo install cargo-cyclonedx'));
		});
	});
}

/**
 * Find the root component in a BOM by matching the name
 */
export function findRootComponent(bom: BOM, projectName: string): Component | undefined {
	// First try the metadata component
	if (bom.metadata?.component) {
		return bom.metadata.component;
	}

	// Then try to find in components by name
	const byName = bom.components.find(c => c.name === projectName);
	if (byName) {
		return byName;
	}

	// If no exact match, just use the first component if it exists
	// (Snyk/cargo might not use the exact project name we specified)
	if (bom.components.length > 0) {
		return bom.components[0];
	}

	return undefined;
}
