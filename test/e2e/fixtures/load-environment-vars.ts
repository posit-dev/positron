/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';

interface ProjectEnvironmentVars {
	[key: string]: string;
}

/**
 * Parse a single line from an env file into key-value pair
 */
function parseEnvLine(line: string): [string, string] | null {
	const trimmed = line.trim();

	// Skip empty lines and comments
	if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
		return null;
	}

	const [key, ...valueParts] = trimmed.split('=');
	if (!key || valueParts.length === 0) {
		return null;
	}

	return [key, valueParts.join('=')];
}

/**
 * Load environment variables from a single .env file
 */
function loadEnvFile(envFilePath: string): ProjectEnvironmentVars {
	const fullPath = join(process.cwd(), envFilePath);

	if (!fs.existsSync(fullPath)) {
		return {};
	}

	try {
		const envContent = fs.readFileSync(fullPath, 'utf8');
		const vars: ProjectEnvironmentVars = {};

		for (const line of envContent.split('\n')) {
			const parsed = parseEnvLine(line);
			if (parsed) {
				const [key, value] = parsed;
				vars[key] = value;
			}
		}

		return vars;
	} catch (error) {
		console.warn(`⚠️ Failed to load ${envFilePath}:`, error);
		return {};
	}
}

/**
 * Environment file mappings per project type
 */
const PROJECT_ENV_FILES: Record<string, string[]> = {
	'e2e-workbench': ['.env.e2e-workbench'],
	'e2e-electron': ['.env.e2e'],
	'e2e-browser': ['.env.e2e'],
	'e2e-browser-server': ['.env.e2e'],
} as const;

/**
 * Apply environment variables to process.env, with logging
 */
function applyEnvironmentVars(vars: ProjectEnvironmentVars, sourceFile: string): void {
	Object.entries(vars).forEach(([key, value]) => {
		if (!value.trim()) {
			console.warn(`⚠️ ${sourceFile}: ${key} is empty, keeping existing value`);
			return;
		}

		const previousValue = process.env[key];
		process.env[key] = value;

		// Optional: log changes for debugging
		if (process.env.DEBUG_ENV_LOADING) {
			console.log(`[${sourceFile}] ${key}: ${previousValue || '(unset)'} → ${value}`);
		}
	});
}

/**
 * Load and apply environment variables for a specific project
 */
export function loadEnvironmentVars(projectName: string): void {
	const envFiles = PROJECT_ENV_FILES[projectName];

	if (!envFiles) {
		// No specific env files for this project - that's fine
		return;
	}

	let totalVarsLoaded = 0;

	for (const envFile of envFiles) {
		const vars = loadEnvFile(envFile);
		const varCount = Object.keys(vars).length;

		if (varCount > 0) {
			applyEnvironmentVars(vars, envFile);
			totalVarsLoaded += varCount;
		}
	}

	if (totalVarsLoaded > 0 && process.env.DEBUG_ENV_LOADING) {
		console.log(`✅ Loaded ${totalVarsLoaded} environment variables for ${projectName}`);
	}
}

/**
 * Validation result for environment variable checks
 */
interface EnvValidationResult {
	isValid: boolean;
	missing: string[];
	empty: string[];
}

/**
 * Check that required environment variables are set and have non-empty values
 *
 * @param requiredVars - Array of environment variable names that must be set
 * @param options - Validation options
 * @returns Validation result with details about missing or empty variables
 */
export function validateEnvironmentVars(
	requiredVars: string[],
	options: { allowEmpty?: boolean } = {}
): EnvValidationResult {
	const { allowEmpty = false } = options;
	const missing: string[] = [];
	const empty: string[] = [];

	for (const varName of requiredVars) {
		const value = process.env[varName];

		if (value === undefined) {
			missing.push(varName);
		} else if (!allowEmpty && value.trim() === '') {
			empty.push(varName);
		}
	}

	const isValid = missing.length === 0 && (allowEmpty || empty.length === 0);

	// Log issues for visibility
	if (missing.length > 0) {
		console.error(`❌ Missing env var(s): ${missing.join(', ')}`);
	}
	if (!allowEmpty && empty.length > 0) {
		console.error(`❌ Empty env var(s): ${empty.join(', ')}`);
	}

	return { isValid, missing, empty };
}
