/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as toml from 'toml';
import { traceError, traceInfo, traceWarn } from './logging.js';


/**
 * Converts snake_case keys to camelCase in an object recursively
 * @param obj Object with snake_case keys
 * @param skipTopLevel If true, skips conversion of top-level keys (used for connection names)
 * @returns Object with camelCase keys
 */
export function toCamelCase<T>(obj: Record<string, any>, skipTopLevel = false): T {
	if (!obj || typeof obj !== 'object' || obj === null) {
		return obj as T;
	}

	const result: Record<string, any> = {};

	for (const [key, value] of Object.entries(obj)) {
		// Determine if we should convert this key
		// Skip conversion if we're at the top level and skipTopLevel is true
		const resultKey = skipTopLevel ? key : key.replace(/_([a-z])/g, (_, char) => char.toUpperCase());

		// Handle nested objects recursively (but don't skip conversion for nested objects)
		result[resultKey] = value && typeof value === 'object' && !Array.isArray(value)
			? toCamelCase(value, false)
			: value;
	}

	return result as T;
}

/**
 * Interface representing Snowflake connections parsed from the TOML file.
 * Based on Snowflake Node.js Driver connection parameters.
 * See: https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-options
 *
 * Note: TOML snake_case keys are automatically converted to camelCase.
 */
export interface SnowflakeConnectionOptions {
	[connectionName: string]: {
		// Core connection parameters
		account: string;
		user?: string;
		password?: string;
		role?: string;
		warehouse?: string;
		database?: string;
		schema?: string;

		// Network parameters
		host?: string;
		port?: string;
		protocol?: string;
		region?: string;

		// Additional connection parameters
		privateKey?: string;
		privateKeyPath?: string;
		privateKeyPass?: string;
		token?: string;
		authenticator?: string;
		serviceName?: string;
		proxyHost?: string;
		proxyPort?: string;
		proxyUser?: string;
		proxyPassword?: string;

		// Any other parameters
		[key: string]: string | number | boolean | undefined;
	};
}

/**
 * Gets the default paths to look for Snowflake connections.toml file based on the platform
 * @returns An array of paths to check in order of priority
 */
export function getDefaultSnowflakeConnectionsPaths(): string[] {
	const platform = os.platform();
	const home = os.homedir();
	const paths: string[] = [];

	// Common location across platforms (highest priority)
	paths.push(path.join(home, '.snowflake', 'connections.toml'));

	switch (platform) {
		case 'linux': {
			// Use XDG_CONFIG_HOME if defined, otherwise default to ~/.config
			const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
			paths.push(path.join(xdgConfigHome, 'snowflake', 'connections.toml'));
			break;
		}
		case 'win32':
			paths.push(path.join(home, 'AppData', 'Local', 'snowflake', 'connections.toml'));
			break;
		case 'darwin': // macOS
			paths.push(path.join(home, 'Library', 'Application Support', 'snowflake', 'connections.toml'));
			break;
		default:
			// For other platforms, use Linux-style path as fallback
			paths.push(path.join(home, '.config', 'snowflake', 'connections.toml'));
			break;
	}

	return paths;
}

/**
 * Reads and parses the Snowflake connections.toml file from the path specified in the settings.
 * Snake_case keys are automatically converted to camelCase.
 *
 * @returns The parsed connections object or undefined if the file doesn't exist or can't be parsed.
 */
export async function getSnowflakeConnectionOptions(): Promise<SnowflakeConnectionOptions | undefined> {
	// Get the path from settings
	const config = vscode.workspace.getConfiguration('catalogExplorer');
	let connectionsPath = config.get<string>('snowflakeConnections') || '$SNOWFLAKE_HOME';
	const pathsToTry: string[] = [];

	// Handle various path resolution cases
	if (connectionsPath === '$SNOWFLAKE_HOME') {
		// Try to get path from SNOWFLAKE_HOME environment variable
		const snowflakeHome = process.env.SNOWFLAKE_HOME;
		if (snowflakeHome) {
			pathsToTry.push(path.join(snowflakeHome, 'connections.toml'));
		}

		// Add platform-specific default paths to try
		pathsToTry.push(...getDefaultSnowflakeConnectionsPaths());

		// See if it is set by the Snowflake extension
		const snowflakeExtension = vscode.workspace.getConfiguration('snowflake').get<string>('connectionsConfigFile');
		if (snowflakeExtension) {
			pathsToTry.push(snowflakeExtension);
		}
	} else {
		// If the setting points to a directory, append the filename
		if (!connectionsPath.endsWith('connections.toml')) {
			connectionsPath = path.join(connectionsPath, 'connections.toml');
		}
		// Add the user-specified path as the only path to try
		pathsToTry.push(connectionsPath);
	}

	// Try each path in order until we find a valid connections file
	for (const pathToTry of pathsToTry) {
		try {
			if (fs.existsSync(pathToTry)) {
				traceInfo(`Loading Snowflake connections from: ${pathToTry}`);
				const content = fs.readFileSync(pathToTry, 'utf8');
				const rawConnections = toml.parse(content);
				// Convert snake_case keys to camelCase, but skip connection names at top level
				return toCamelCase<SnowflakeConnectionOptions>(rawConnections, true);
			}
		} catch (error) {
			traceError(`Error reading or parsing Snowflake connections file at ${pathToTry}: ${error}`);
		}
	}

	// If we get here, no valid connections file was found
	traceWarn(`Snowflake connections file not found at any of these locations: ${pathsToTry.join(', ')}`);
	return undefined;
}

export interface DatabricksCredentialProvider {
	getToken(workspace: string): Promise<string | undefined>;
}

/**
 * A basic credential provider that delegates to the extension's secret storage
 * for a Databricks PAT, with some basic in-memory caching.
 */
export class DefaultDatabricksCredentialProvider
	implements DatabricksCredentialProvider {
	private cache = new Map<string, string>();

	constructor(private store: vscode.SecretStorage) {
		this.store.onDidChange(async (e) => {
			if (!this.cache.has(e.key)) {
				return;
			}
			const newValue = await this.store.get(e.key);
			this.cache.set(e.key, newValue ?? '');
		});
	}

	async getToken(workspace: string): Promise<string | undefined> {
		const key = workspace.startsWith('https://')
			? workspace
			: `https://${workspace}`;
		const cached = this.cache.get(key);
		if (cached) {
			return cached;
		}
		const value = await this.store.get(key);
		if (value) {
			this.cache.set(key, value);
		}
		return value;
	}

	async removeToken(workspace: string): Promise<void> {
		const key = workspace.startsWith('https://')
			? workspace
			: `https://${workspace}`;
		this.cache.delete(key);
		await this.store.delete(key);
	}
}
