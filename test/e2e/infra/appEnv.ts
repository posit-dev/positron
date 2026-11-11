/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Keep this file import-free: launch.sh loads it via tsx before the harness exists.

/** Env var names that look like secrets. PAT is a whole word so PATH and *_PATH names pass. */
export const SECRET_NAME_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASSKEY|PASSPHRASE|CREDENTIAL|LICENSE|OTP|WEBHOOK|PEM|REGCODE|(^|_)PAT(_|$))/i;

/**
 * CI secrets mapped into e2e test step env, plus the 1Password and GitHub tokens.
 * Backup for names the pattern misses (and for the ones it catches).
 */
export const SECRET_ENV_DENYLIST: readonly string[] = [
	'CONNECT_BOOTSTRAP_SECRETKEY',
	'DATABRICKS_PAT',
	'DATABRICKS_WORKSPACE',
	'E2E_CONNECT_APIKEY',
	'E2E_CONNECT_SERVER',
	'GH_TOKEN',
	'GITHUB_TOKEN',
	'OP_MANAGED_VARIABLES',
	'OP_SERVICE_ACCOUNT_TOKEN',
	'POSIT_WORKBENCH_PASSWORD',
	'SNOWFLAKE_ACCOUNT',
	'SNOWFLAKE_PASSWORD',
	'SNOWFLAKE_USER',
	'WB_PASSWORD',
];

/** Names kept even though they match the pattern. Never beats the denylist or 1Password names. */
export const SECRET_ENV_ALLOWLIST: readonly string[] = [
	// A fixed test value for a Postgres container each job starts for itself.
	'E2E_POSTGRES_PASSWORD',
];

const MIN_SECRET_LENGTH = 8;
const MIN_LINE_LENGTH = 20;
const NON_SECRET_SUFFIX = /(_URL|_HOST|_HOSTNAME|_USER|_USERNAME|_EMAIL|_ORG|_ACCOUNT|_SERVER|_WORKSPACE|_PATH)$/i;

export interface SecretValue {
	name: string;
	value: string;
}

function norm(name: string, platform: NodeJS.Platform): string {
	return platform === 'win32' ? name.toLowerCase() : name;
}

/** Names in `source` that must not reach the app. */
export function secretEnvNames(
	source: NodeJS.ProcessEnv,
	platform: NodeJS.Platform = process.platform,
	allowlist: readonly string[] = SECRET_ENV_ALLOWLIST
): string[] {
	const managedKey = Object.keys(source).find(k => norm(k, platform) === norm('OP_MANAGED_VARIABLES', platform));
	const managed = new Set(
		(managedKey ? source[managedKey] ?? '' : '')
			.split(',')
			.map(n => n.trim())
			.filter(Boolean)
			.map(n => norm(n, platform))
	);
	const deny = new Set(SECRET_ENV_DENYLIST.map(n => norm(n, platform)));
	const allow = new Set(allowlist.map(n => norm(n, platform)));

	return Object.keys(source).filter(name => {
		const key = norm(name, platform);
		if (managed.has(key) || deny.has(key)) {
			return true;
		}
		return SECRET_NAME_PATTERN.test(name) && !allow.has(key);
	});
}

/** `source` without secrets, then `extraEnv` applied on top (undefined unsets). */
export function appEnv(
	source: NodeJS.ProcessEnv,
	extraEnv: Record<string, string | undefined> = {},
	platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...source };
	for (const name of secretEnvNames(source, platform)) {
		delete env[name];
	}
	for (const [name, value] of Object.entries(extraEnv)) {
		for (const k of Object.keys(env)) {
			if (norm(k, platform) === norm(name, platform)) {
				delete env[k];
			}
		}
		if (value !== undefined) {
			env[name] = value;
		}
	}
	return env;
}

/**
 * For a URL with a password or a query string (`postgres://svc:pw@db`, `https://h/?token=x`),
 * the whole URL plus its decoded password. Empty for anything else.
 */
function urlCredentials(value: string): string[] {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return [];
	}
	if (url.password === '' && url.search === '') {
		return [];
	}
	if (url.password === '') {
		return [value];
	}
	let password = url.password;
	try {
		password = decodeURIComponent(password);
	} catch {
		// A broken percent escape: keep the raw password.
	}
	return [value, password];
}

/** Values that scrub and scan look for. */
export function secretValues(source: NodeJS.ProcessEnv): SecretValue[] {
	const seen = new Set<string>();
	const result: SecretValue[] = [];
	const add = (name: string, value: string) => {
		if (!seen.has(value)) {
			seen.add(value);
			result.push({ name, value });
		}
	};

	for (const name of secretEnvNames(source)) {
		const value = source[name]?.trim();
		if (!value || name.toUpperCase() === 'OP_MANAGED_VARIABLES') {
			continue;
		}
		// Hosts, users, and URLs show up in logs and on screen. Scanning for them would block
		// uploads, so they count only when the URL carries a credential.
		if (NON_SECRET_SUFFIX.test(name) && !SECRET_NAME_PATTERN.test(name)) {
			for (const part of urlCredentials(value)) {
				if (part.length >= MIN_SECRET_LENGTH) {
					add(name, part);
				}
			}
			continue;
		}
		if (/[\r\n]/.test(value)) {
			for (const line of value.split(/\r?\n/).map(l => l.trim())) {
				if (line.length >= MIN_LINE_LENGTH && !line.startsWith('-----')) {
					add(name, line);
				}
			}
		}
		if (value.length >= MIN_SECRET_LENGTH) {
			add(name, value);
		}
	}
	return result;
}
