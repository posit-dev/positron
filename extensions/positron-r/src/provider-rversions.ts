/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { RBinary } from './provider.js';
import { ReasonDiscovered } from './r-installation.js';
import { LOGGER } from './extension.js';

/**
 * Represents a single entry parsed from an r-versions file.
 */
export interface RVersionEntry {
	/** R installation root directory (R_HOME) */
	path?: string;
	/** User-friendly display name */
	label?: string;
	/** Environment module to load */
	module?: string;
	/** Shell script to run before launching R */
	script?: string;
	/** CRAN repository URL or path to repos.conf */
	repo?: string;
	/** Colon-separated list of R library directories */
	library?: string;
}

/**
 * Parse an r-versions file into a list of entries.
 *
 * The file format uses key-value pairs with entries separated by blank lines:
 * ```
 * Path: /opt/R/4.3.0
 * Label: R 4.3.0 (Production)
 *
 * Path: /opt/R/4.4.0
 * Label: R 4.4.0 (Development)
 * ```
 *
 * @param content The file content to parse
 * @returns Array of parsed entries
 */
export function parseRVersionsFile(content: string): RVersionEntry[] {
	const entries: RVersionEntry[] = [];

	// Split into entry blocks separated by blank lines
	const blocks = content.split(/\n\s*\n/);

	for (const block of blocks) {
		const trimmedBlock = block.trim();
		if (!trimmedBlock) {
			continue;
		}

		const entry: RVersionEntry = {};
		const lines = trimmedBlock.split('\n');

		for (const line of lines) {
			const trimmedLine = line.trim();
			if (!trimmedLine || trimmedLine.startsWith('#')) {
				continue;
			}

			// Parse key: value format
			const colonIndex = trimmedLine.indexOf(':');
			if (colonIndex === -1) {
				LOGGER.warn(`Invalid line in r-versions file (no colon): ${trimmedLine}`);
				continue;
			}

			const key = trimmedLine.substring(0, colonIndex).trim().toLowerCase();
			const value = trimmedLine.substring(colonIndex + 1).trim();

			switch (key) {
				case 'path':
					entry.path = value;
					break;
				case 'label':
					entry.label = value;
					break;
				case 'module':
					entry.module = value;
					break;
				case 'script':
					entry.script = value;
					break;
				case 'repo':
					entry.repo = value;
					break;
				case 'library':
					entry.library = value;
					break;
				default:
					LOGGER.debug(`Unknown key in r-versions file: ${key}`);
			}
		}

		// An entry must have either Path or Module
		if (entry.path || entry.module) {
			entries.push(entry);
		} else {
			LOGGER.warn('Skipping r-versions entry without Path or Module field');
		}
	}

	return entries;
}

/**
 * Find the r-versions file in standard locations.
 *
 * Checks XDG config directories and /etc/rstudio/r-versions on Unix-like systems.
 * The primary use case is Linux servers running Posit Workbench.
 *
 * @returns Path to the r-versions file, or undefined if not found
 */
export function findRVersionsFile(): string | undefined {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	const xdg = require('xdg-portable/cjs');
	const configDirs: string[] = xdg.configDirs();

	// On Unix-like systems, also check /etc (RStudio Workbench uses /etc/rstudio)
	if (process.platform !== 'win32') {
		configDirs.push('/etc');
	}

	// Check rstudio directories (for compatibility with Posit Workbench)
	// We could also check 'positron' directories in the future
	for (const configDir of configDirs) {
		const rVersionsPath = path.join(configDir, 'rstudio', 'r-versions');
		if (fs.existsSync(rVersionsPath)) {
			LOGGER.info(`Found r-versions file at ${rVersionsPath}`);
			return rVersionsPath;
		}
	}

	return undefined;
}

/**
 * Convert an r-versions entry path to an R binary path.
 *
 * The Path field in r-versions specifies the R_HOME directory,
 * so we need to find the actual R binary within it.
 *
 * @param rHomePath The R_HOME path from the r-versions entry
 * @returns Path to the R binary, or undefined if not found
 */
function getRBinaryFromHome(rHomePath: string): string | undefined {
	// Standard location for the R binary relative to R_HOME on Unix
	const binPath = path.join(rHomePath, 'bin', 'R');
	if (fs.existsSync(binPath)) {
		return binPath;
	}

	LOGGER.warn(`Could not find R binary in R_HOME: ${rHomePath}`);
	return undefined;
}

/**
 * Discover R binaries from the r-versions configuration file.
 *
 * This reads the Posit Workbench r-versions file format to discover
 * R installations with extended metadata.
 *
 * @returns Array of discovered R binaries
 */
export async function discoverRVersionsBinaries(): Promise<RBinary[]> {
	// r-versions is a Posit Workbench feature, which only runs on Linux
	if (process.platform === 'win32') {
		return [];
	}

	const rVersionsPath = findRVersionsFile();
	if (!rVersionsPath) {
		LOGGER.debug('No r-versions file found');
		return [];
	}

	let content: string;
	try {
		content = fs.readFileSync(rVersionsPath, 'utf-8');
	} catch (error) {
		LOGGER.warn(`Failed to read r-versions file: ${error}`);
		return [];
	}

	const entries = parseRVersionsFile(content);
	LOGGER.info(`Parsed ${entries.length} entries from r-versions file`);

	const binaries: RBinary[] = [];

	for (const entry of entries) {
		// For now, only handle entries with Path field
		// TODO: module field support will be added in a later PR
		if (!entry.path) {
			if (entry.module) {
				LOGGER.info(`Skipping r-versions entry with Module field (not yet supported): ${entry.module}`);
			}
			continue;
		}

		// Verify the path exists
		if (!fs.existsSync(entry.path)) {
			LOGGER.warn(`R_HOME path from r-versions does not exist: ${entry.path}`);
			continue;
		}

		// Find the R binary within the R_HOME directory
		const binPath = getRBinaryFromHome(entry.path);
		if (!binPath) {
			continue;
		}

		binaries.push({
			path: binPath,
			reasons: [ReasonDiscovered.RVERSIONS],
			// Future PRs will add metadata for label, script, repo, library
		});

		LOGGER.info(`Found R at ${binPath} from r-versions file`);
	}

	return binaries;
}
