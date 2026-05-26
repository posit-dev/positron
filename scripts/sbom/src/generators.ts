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
			const text = chunk.toString('utf8');
			errBuffer += text;
			// Log stderr in real-time for debugging cargo-cyclonedx output location
			if (text.includes('Wrote') || text.includes('wrote') || text.includes('Writing') || text.includes('writing')) {
				console.info(`  ${text.trim()}`);
			}
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
							f.endsWith('_sbom.json') ||
							// Accept any .json file that's not a cache, config, or OpenAPI spec
							(f.endsWith('.json') &&
								!f.includes('cache') &&
								!f.includes('config') &&
								!f.includes('openapi') &&
								!f.startsWith('.'))
						).filter(f => {
							// Further filter out OpenAPI specs by checking file content
							try {
								const testPath = resolvePath(resolvedPath, f);
								const content = readFileSync(testPath, 'utf-8');
								const json = JSON.parse(content);
								// Skip if it's an OpenAPI spec
								return json.openapi === undefined;
							} catch {
								return false;
							}
						});

						if (candidates.length > 0) {
							foundFile = resolvePath(resolvedPath, candidates[0]);
							console.info(`  Found SBOM file: ${candidates[0]}`);
						} else {
							// For workspaces like Ark, check crates/ directory and merge all SBOMs
							const cratesDir = resolvePath(resolvedPath, 'crates');
							if (existsSync(cratesDir)) {
								console.info(`  Workspace detected, collecting all crate SBOMs...`);
								const allBomFiles: string[] = [];
								const crateDirs = readdirSync(cratesDir);

								for (const crateDir of crateDirs) {
									const cratePath = resolvePath(cratesDir, crateDir);
									if (!existsSync(resolvePath(cratePath, 'Cargo.toml'))) {
										continue;
									}

									const crateFiles = readdirSync(cratePath);
									const bomFiles = crateFiles.filter(f =>
										f.endsWith('.json') &&
										!f.includes('cache') &&
										!f.includes('config')
									);

									for (const bomFile of bomFiles) {
										const bomPath = resolvePath(cratePath, bomFile);
										// Validate it's a CycloneDX SBOM
										try {
											const content = readFileSync(bomPath, 'utf-8');
											const testBom = JSON.parse(content);
											if (testBom.bomFormat && Array.isArray(testBom.components)) {
												allBomFiles.push(bomPath);
												console.info(`    Found valid SBOM: crates/${crateDir}/${bomFile}`);
											}
										} catch (e) {
											// Skip invalid files
										}
									}
								}

								// Merge all workspace member SBOMs for complete coverage
								if (allBomFiles.length > 0) {
									if (allBomFiles.length === 1) {
										foundFile = allBomFiles[0];
									} else {
										// Multiple SBOMs - merge them into a single BOM
										console.info(`  Merging ${allBomFiles.length} workspace member SBOMs...`);
										const mergedBom = createEmptyBom();
										mergedBom.metadata.component.name = project.name;

										for (const bomFile of allBomFiles) {
											const content = readFileSync(bomFile, 'utf-8');
											const workspaceBom = JSON.parse(content);

											// Add all components and dependencies
											if (workspaceBom.components) {
												mergedBom.components.push(...workspaceBom.components);
											}
											if (workspaceBom.dependencies) {
												mergedBom.dependencies.push(...workspaceBom.dependencies);
											}
										}

										console.info(`  Merged ${mergedBom.components.length} total components from workspace`);

										// Return the merged BOM directly
										resolve(mergedBom);
										return;
									}
								}
							}

							if (!foundFile) {
								const jsonFiles = files.filter(f => f.endsWith('.json'));
								console.error(`[ERROR] No SBOM output file found in ${resolvedPath}`);
								console.error(`  JSON files present: ${jsonFiles.join(', ') || '(none)'}`);
							}
						}
					}

					if (!foundFile) {
						resolve(createEmptyBom());
						return;
					}

					const bomContent = readFileSync(foundFile, 'utf-8');
					const bom = JSON.parse(bomContent);

					// Validate it's a proper CycloneDX BOM
					if (!bom.bomFormat || !Array.isArray(bom.components)) {
						console.error(`[ERROR] Invalid SBOM format in ${foundFile}`);
						console.error(`  File does not appear to be a CycloneDX SBOM`);
						resolve(createEmptyBom());
						return;
					}

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
