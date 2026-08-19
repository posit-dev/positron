/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AuthProviderLogger } from '../authProviderLogger';

const logger = new AuthProviderLogger('Databricks Auth');

const DEFAULT_PROFILE = 'workbench';

export interface DatabricksConfigCredential {
	token: string;
	host?: string;
	configFile: string;
	profile: string;
}

function expandTildePath(filePath: string): string {
	if (filePath.startsWith('~')) {
		return path.join(os.homedir(), filePath.slice(1));
	}
	return filePath;
}

/**
 * Path to the Databricks config file: DATABRICKS_CONFIG_FILE when set
 * (Workbench managed sessions set it), else ~/.databrickscfg per the
 * Databricks client unified authentication spec.
 */
export function getDatabricksConfigPath(
	env: NodeJS.ProcessEnv = process.env
): string {
	const configured = env.DATABRICKS_CONFIG_FILE?.trim();
	if (configured) {
		return expandTildePath(configured);
	}
	return path.join(os.homedir(), '.databrickscfg');
}

/**
 * Parse ini-style text into section -> key/value maps. Handles `#`/`;`
 * comments, blank lines, and optional double quotes around values.
 * Keys before the first section header are ignored.
 */
export function parseIniSections(
	content: string
): Map<string, Record<string, string>> {
	const sections = new Map<string, Record<string, string>>();
	let current: Record<string, string> | undefined;
	for (const rawLine of content.split('\n')) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#') || line.startsWith(';')) {
			continue;
		}
		const header = line.match(/^\[(?<name>[^\]]+)\]$/);
		if (header?.groups) {
			current = {};
			sections.set(header.groups.name.trim(), current);
			continue;
		}
		const eq = line.indexOf('=');
		if (eq > 0 && current) {
			const key = line.slice(0, eq).trim();
			let value = line.slice(eq + 1).trim();
			if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
				value = value.slice(1, -1);
			}
			current[key] = value;
		}
	}
	return sections;
}

/**
 * Read the OAuth token (and host) from the Databricks config file profile.
 * Returns undefined when the file, profile, or token is missing - callers
 * fall back to the interactive sign-in flow.
 */
export async function detectDatabricksConfigCredentials(
	env: NodeJS.ProcessEnv = process.env
): Promise<DatabricksConfigCredential | undefined> {
	const configFile = getDatabricksConfigPath(env);
	const profile = env.DATABRICKS_CONFIG_PROFILE?.trim() || DEFAULT_PROFILE;

	let content: string;
	try {
		content = await fs.promises.readFile(configFile, 'utf8');
	} catch {
		logger.debug(`No Databricks config file at ${configFile}`);
		return undefined;
	}

	const section = parseIniSections(content).get(profile);
	if (!section) {
		logger.warn(`Profile [${profile}] not found in ${configFile}`);
		return undefined;
	}
	if (!section.token) {
		logger.warn(`Profile [${profile}] in ${configFile} has no token`);
		return undefined;
	}
	logger.info(`Using Databricks credentials from ${configFile} [${profile}]`);
	return {
		token: section.token,
		host: section.host || undefined,
		configFile,
		profile,
	};
}
