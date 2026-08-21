/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The real IOdbcConfigHost: reads ini files from disk on unix-like platforms, and the ODBC hives
// out of the Windows registry via reg.exe. Kept separate from odbcinst.ts so that module stays a
// pure, fixture-testable parser.

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { IOdbcConfigHost, OdbcRegistrySnapshot } from './odbcinst';

/**
 * Parses the output of `reg.exe query <key> /s` into a map of subkey name -> values. Only the leaf
 * segment of each key path is kept, which is exactly what ODBC needs: under ODBCINST.INI the
 * subkeys are driver names, and under ODBC.INI they are DSN names.
 *
 * A `reg query` dump looks like:
 *
 *     HKEY_LOCAL_MACHINE\SOFTWARE\ODBC\ODBCINST.INI\PostgreSQL Unicode
 *         Driver    REG_SZ    C:\Program Files\psqlODBC\psqlodbc35w.dll
 *
 * Exported for tests.
 */
export function parseRegQueryOutput(output: string, rootKey: string): Record<string, Record<string, string>> {
	const result: Record<string, Record<string, string>> = {};
	// reg.exe echoes the full hive name in its output, whatever abbreviation the query used, so the
	// root has to be expanded before it will match.
	const expandedRoot = rootKey
		.replace(/^HKLM\\/i, 'HKEY_LOCAL_MACHINE\\')
		.replace(/^HKCU\\/i, 'HKEY_CURRENT_USER\\');
	const rootPrefix = `${expandedRoot.toLowerCase()}\\`;
	let current: Record<string, string> | undefined;

	for (const rawLine of output.split(/\r?\n/)) {
		if (rawLine.trim().length === 0) {
			continue;
		}

		// Key paths start at column zero; values are indented.
		if (!/^\s/.test(rawLine)) {
			const keyPath = rawLine.trim();
			current = undefined;
			if (keyPath.toLowerCase().startsWith(rootPrefix)) {
				const relative = keyPath.slice(expandedRoot.length + 1);
				// Only direct children are entries; anything deeper belongs to a driver's own
				// subkeys, which ODBC does not use for discovery.
				if (relative.length > 0 && !relative.includes('\\')) {
					current = result[relative] ??= {};
				}
			}
			continue;
		}

		if (current === undefined) {
			continue;
		}

		// "    Name    REG_SZ    value". The name and the value may both contain spaces, so split
		// on the type token rather than on whitespace.
		const match = /^\s+(?<name>.*?)\s{4}(?<type>REG_[A-Z_]+)\s{4}(?<value>.*)$/.exec(rawLine);
		if (match?.groups) {
			current[match.groups.name.trim()] = match.groups.value;
		}
	}

	return result;
}

/** Runs `reg.exe query <key> /s`, returning undefined when the key is absent or reg.exe fails. */
function queryRegistry(key: string): Record<string, Record<string, string>> | undefined {
	try {
		const output = execFileSync('reg.exe', ['query', key, '/s'], {
			encoding: 'utf-8',
			windowsHide: true,
			// A machine with many DSNs still produces a small dump; this is only a guard against a
			// pathological registry.
			maxBuffer: 8 * 1024 * 1024,
		});
		return parseRegQueryOutput(output, key);
	} catch {
		// The key does not exist (no ODBC drivers or no DSNs of that scope), or reg.exe is
		// unavailable. Both are "nothing to report" rather than errors.
		return undefined;
	}
}

/**
 * Creates the production configuration host.
 * @param platform The platform to resolve for. Defaults to the current one; injectable so a test
 * can exercise the Windows paths from a unix machine.
 */
export function createNodeConfigHost(platform: NodeJS.Platform = process.platform): IOdbcConfigHost {
	return {
		platform,

		readFile(filePath: string): string | undefined {
			try {
				return fs.readFileSync(filePath, 'utf-8');
			} catch {
				// Missing, unreadable, or a directory. All mean "no configuration here".
				return undefined;
			}
		},

		exists(filePath: string): boolean {
			try {
				return fs.existsSync(filePath);
			} catch {
				return false;
			}
		},

		homeDir(): string {
			return os.homedir();
		},

		env(name: string): string | undefined {
			const value = process.env[name];
			return value !== undefined && value.length > 0 ? value : undefined;
		},

		readRegistry(): OdbcRegistrySnapshot | undefined {
			if (platform !== 'win32') {
				return undefined;
			}
			return {
				drivers: queryRegistry('HKLM\\SOFTWARE\\ODBC\\ODBCINST.INI') ?? {},
				systemDsns: queryRegistry('HKLM\\SOFTWARE\\ODBC\\ODBC.INI') ?? {},
				userDsns: queryRegistry('HKCU\\SOFTWARE\\ODBC\\ODBC.INI') ?? {},
			};
		},
	};
}
