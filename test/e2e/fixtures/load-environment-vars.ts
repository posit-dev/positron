/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { join } from 'path';

interface ProjectEnvironmentVars {
	[key: string]: string;
}

function loadEnvFile(envFilePath: string): ProjectEnvironmentVars {
	const vars: ProjectEnvironmentVars = {};
	const fullPath = join(process.cwd(), envFilePath);

	if (!fs.existsSync(fullPath)) {
		return vars;
	}

	try {
		const envContent = fs.readFileSync(fullPath, 'utf8');
		const envLines = envContent.split('\n');

		for (const line of envLines) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
				const [key, ...valueParts] = trimmed.split('=');
				if (key && valueParts.length > 0) {
					vars[key] = valueParts.join('=');
				}
			}
		}
	} catch (error) {
		console.warn(`⚠️ Failed to load ${envFilePath}:`, error);
	}

	return vars;
}

export function loadProjectEnvironmentVariables(projectName: string): void {
	// Define environment file mappings per project
	const envFileMappings: Record<string, string[]> = {
		'e2e-workbench': ['.env.e2e-workbench'],
		'e2e-electron': ['.env.e2e'],
		'e2e-browser': ['.env.e2e'],
		'e2e-browser-server': ['.env.e2e'],
	};

	const envFiles = envFileMappings[projectName];
	if (!envFiles) {
		return; // No specific env files for this project
	}

	const originalVars: Record<string, string | undefined> = {};
	let totalVarsLoaded = 0;

	for (const envFile of envFiles) {
		const vars = loadEnvFile(envFile);
		if (Object.keys(vars).length > 0) {
			// Store original values so we can restore them if needed
			Object.keys(vars).forEach(key => {
				if (!(key in originalVars)) {
					originalVars[key] = process.env[key];
				}
			});

			// Set environment variables (later files override earlier ones)
			Object.entries(vars).forEach(([key, value]) => {
				if (!value) {
					console.log(`${envFile}: ${key} is empty, falling back to: ${originalVars[key]}`);
				} else {
					process.env[key] = value;
					// console.log(`🔧 [${projectName}] Set environment variable: ${key} = ${value}`);
				}
			});
			totalVarsLoaded += Object.keys(vars).length;
		}
	}
}
