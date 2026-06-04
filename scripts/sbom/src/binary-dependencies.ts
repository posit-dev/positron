/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Project } from './types';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { getRepoRoot } from './utils';

/**
 * Binary dependencies that are downloaded as pre-built binaries from external repositories.
 *
 * For SBOM generation, we have two strategies:
 * 1. SCAN_SOURCE: Clone the source repo at the specific version and scan it with cargo-cyclonedx
 * 2. EXTERNAL_REF: Document as an external reference (placeholder for future SBOM fetch/merge)
 *
 * SCAN_SOURCE is preferred when:
 * - Source repo is public
 * - Binary is built from that exact source (not vendored deps)
 * - We want complete dependency coverage NOW
 */

export type BinaryDependencyStrategy = 'SCAN_SOURCE' | 'EXTERNAL_REF';

export interface BinaryDependency {
	name: string;
	version: string | 'submodule';
	description: string;
	repository: string;
	/** Strategy for including in SBOM */
	strategy: BinaryDependencyStrategy;
	/** Path to package.json that declares this dependency (for version validation) */
	packageJsonPath?: string;
	/** Key in package.json positron.binaryDependencies */
	packageJsonKey?: string;
	/** Path where source will be cloned (relative to repo root) */
	clonePath?: string;
}

/**
 * Read the version of a binary dependency from package.json
 */
function getVersionFromPackageJson(packageJsonPath: string, key: string): string {
	try {
		const fullPath = resolvePath(getRepoRoot(), packageJsonPath);
		const packageJson = JSON.parse(readFileSync(fullPath, 'utf-8'));
		return packageJson.positron?.binaryDependencies?.[key] || 'unknown';
	} catch (error) {
		console.warn(`Failed to read ${key} version from ${packageJsonPath}: ${error}`);
		return 'unknown';
	}
}

/**
 * List of binary dependencies downloaded from external repositories.
 */
export const BINARY_DEPENDENCIES: BinaryDependency[] = [
	{
		name: 'Kallichore',
		// Version is read from positron-supervisor/package.json at runtime
		version: getVersionFromPackageJson(
			'extensions/positron-supervisor/package.json',
			'kallichore'
		),
		description: 'Python kernel server for Positron',
		repository: 'https://github.com/posit-dev/kallichore',
		strategy: 'SCAN_SOURCE',
		packageJsonPath: 'extensions/positron-supervisor/package.json',
		packageJsonKey: 'kallichore',
		clonePath: '.sbom-tmp/kallichore'
	},
	{
		name: 'Ark (R Kernel) Prebuild',
		version: 'submodule',
		description: 'Pre-built R kernel binary (from posit-dev/positron-ark)',
		repository: 'https://github.com/posit-dev/positron-ark',
		strategy: 'EXTERNAL_REF',
		// Note: Ark source is ALREADY scanned via the git submodule in extensions/positron-r/ark.
		// The shipped binary comes from a prebuild, but we're scanning the source it was built from.
		// If prebuild differs significantly (different feature flags, etc), we'd need to fetch
		// its SBOM from the release assets.
	}
];

/**
 * Convert binary dependencies to Projects that can be scanned.
 * Only returns projects for dependencies with SCAN_SOURCE strategy.
 */
export function getBinaryDependencyProjects(): Project[] {
	return BINARY_DEPENDENCIES
		.filter(dep => dep.strategy === 'SCAN_SOURCE' && dep.clonePath && dep.version !== 'submodule')
		.map(dep => ({
			name: dep.name,
			path: dep.clonePath!,
			type: 'rust' as const
		}));
}
