/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { resolve as resolvePath } from 'path';
import { BOM, Project } from './types';
import { createEmptyBom, getRepoRoot } from './utils';
import { existsSync, readFileSync, readdirSync } from 'fs';

/**
 * Generate SBOM for an npm project using Snyk
 */
export async function generateNpmSbom(project: Project): Promise<BOM> {
	return new Promise((resolve) => {
		const resolvedPath = resolvePath(getRepoRoot(), project.path);
		console.info(`Generating SBOM for npm project: ${project.name} at ${resolvedPath}`);

		const proc = spawn('snyk', ['sbom', '--format=cyclonedx1.4+json', resolvedPath]);

		let buffer = '';
		let errBuffer = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString('utf8');
		});

		proc.stderr.on('data', (chunk: Buffer) => {
			errBuffer += chunk.toString('utf8');
		});

		proc.on('close', (code) => {
			if (code === 0) {
				console.info(`[OK] Generated SBOM for: ${project.name}`);
				try {
					const bom = JSON.parse(buffer);
					resolve(bom);
				} catch (e) {
					console.error(`[ERROR] Failed to parse SBOM for ${project.name}: ${e}`);
					console.error('Buffer contents:', buffer);
					resolve(createEmptyBom());
				}
			} else {
				console.error(`[ERROR] Failed to generate SBOM for: ${project.name} (exit code: ${code})`);
				if (errBuffer) {
					console.error('stderr:', errBuffer);
				}
				if (buffer) {
					console.error('stdout:', buffer);
				}
				resolve(createEmptyBom());
			}
		});

		proc.on('error', (err) => {
			console.error(`[ERROR] Error spawning snyk for ${project.name}:`, err);
			resolve(createEmptyBom());
		});
	});
}

/**
 * Generate SBOM for a Rust project using cargo-cyclonedx
 */
export async function generateRustSbom(project: Project): Promise<BOM> {
	return new Promise((resolve) => {
		const resolvedPath = resolvePath(getRepoRoot(), project.path);
		console.info(`Generating SBOM for Rust project: ${project.name} at ${resolvedPath}`);

		// Check if Cargo.toml exists
		const cargoTomlPath = resolvePath(resolvedPath, 'Cargo.toml');
		if (!existsSync(cargoTomlPath)) {
			console.error(`[ERROR] Cargo.toml not found at ${cargoTomlPath}`);
			resolve(createEmptyBom());
			return;
		}

		// cargo-cyclonedx writes to a file in the current directory
		// Use --override-filename to specify a known location (it will add .json)
		const outputFile = 'sbom-output';
		const proc = spawn('cargo', [
			'cyclonedx',
			'--format', 'json',
			'--all',  // Include all workspace members
			'--override-filename', outputFile
		], {
			cwd: resolvedPath
		});

		let buffer = '';
		let errBuffer = '';

		proc.stdout.on('data', (chunk: Buffer) => {
			buffer += chunk.toString('utf8');
		});

		proc.stderr.on('data', (chunk: Buffer) => {
			errBuffer += chunk.toString('utf8');
		});

		proc.on('close', (code) => {
			if (code === 0) {
				console.info(`[OK] Generated SBOM for: ${project.name}`);
				try {
					// cargo-cyclonedx adds .json to the filename, so try both variations
					let foundFile: string | null = null;

					// Try the most likely patterns first
					const patterns = [
						`${outputFile}.json`,           // sbom-output.json
						outputFile,                      // sbom-output
						`${outputFile}.json.json`        // sbom-output.json.json (double extension)
					];

					for (const pattern of patterns) {
						const testPath = resolvePath(resolvedPath, pattern);
						if (existsSync(testPath)) {
							foundFile = testPath;
							break;
						}
					}

					// If not found, search the directory for any SBOM-like files
					if (!foundFile) {
						const files = readdirSync(resolvedPath);
						const candidates = files.filter(f =>
							f.endsWith('.cdx.json') ||
							(f.includes('sbom') && f.endsWith('.json')) ||
							f.endsWith('_sbom.json')
						);

						if (candidates.length > 0) {
							foundFile = resolvePath(resolvedPath, candidates[0]);
							console.info(`  Found SBOM file: ${candidates[0]}`);
						} else {
							// List all JSON files for debugging
							const jsonFiles = files.filter(f => f.endsWith('.json'));
							console.error(`[ERROR] No SBOM output file found in ${resolvedPath}`);
							console.error(`  JSON files present: ${jsonFiles.join(', ') || '(none)'}`);
						}
					}

					if (!foundFile) {
						resolve(createEmptyBom());
						return;
					}

					const bomContent = readFileSync(foundFile, 'utf-8');
					const bom = JSON.parse(bomContent);
					resolve(bom);
				} catch (e) {
					console.error(`[ERROR] Failed to parse SBOM for ${project.name}: ${e}`);
					resolve(createEmptyBom());
				}
			} else {
				console.error(`[ERROR] Failed to generate SBOM for: ${project.name} (exit code: ${code})`);
				if (errBuffer) {
					console.error('stderr:', errBuffer);
				}
				resolve(createEmptyBom());
			}
		});

		proc.on('error', (err) => {
			console.error(`[ERROR] Error spawning cargo-cyclonedx for ${project.name}:`, err);
			resolve(createEmptyBom());
		});
	});
}
