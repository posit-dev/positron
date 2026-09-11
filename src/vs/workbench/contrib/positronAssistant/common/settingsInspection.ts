/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Placeholder shown in place of a redacted setting value. */
export const REDACTED_VALUE = '<redacted>';

/**
 * How a caller decides that a setting key may hold a credential. Two lists,
 * because the useful tokens differ in how safely they can be matched loosely:
 * `apikey` is unambiguous as a substring of the final segment, `pat` is not
 * (`defaultInterpreterPath` contains it).
 */
export interface ISensitiveKeyMatcher {
	/** Matched as a substring of the key's last segment, case-insensitively. */
	readonly segments: readonly string[];
	/** Matched against the whole last segment, case-insensitively. */
	readonly exactSegments?: readonly string[];
	/**
	 * Matched against the whole key, case-insensitively (list entries must be
	 * lowercase). For settings whose values carry credentials even though no
	 * segment of the key is credential-shaped.
	 */
	readonly exactKeys?: readonly string[];
}

/**
 * The AI diagnostics report's list, unchanged from when it lived in
 * aiDiagnostics.ts.
 *
 * Note `credentials` is deliberately NOT here: the `authentication.*.credentials`
 * settings hold non-secret config vars (AWS_PROFILE/AWS_REGION, SNOWFLAKE_ACCOUNT,
 * GOOGLE_VERTEX_PROJECT, etc.), not the actual secrets, which resolve from the
 * environment or credential chain. Those values are useful in a report.
 */
export const REPORT_SENSITIVE_KEYS: ISensitiveKeyMatcher = {
	segments: ['customheaders', 'apikey', 'token', 'secret', 'password'],
};

/**
 * The getConfiguredSettings payload's list: a superset of the report's, because
 * the payload enters an LLM transcript that leaves the machine and that the user
 * never reviews, whereas the report is an editor the user reads and chooses to
 * share.
 *
 * `credentials` and `cookie` are safe as substrings. `authorization` is also safe
 * as a substring: it catches `http.proxyAuthorization` (a Basic credential sent
 * verbatim as the Proxy-Authorization header) without touching anything ending in
 * `authority` (e.g. `remote.SSH.authority`), since "authorization" is not a
 * substring of "authority". `key`, `auth` and `pat` are whole-segment matches
 * only: as substrings they would redact `sendKeybindingsToShell`, anything ending
 * in `authority`, and `defaultInterpreterPath`. An interpreter path is exactly
 * the kind of setting this payload exists to report, so redacting it would defeat
 * the command.
 */
export const PAYLOAD_SENSITIVE_KEYS: ISensitiveKeyMatcher = {
	segments: [...REPORT_SENSITIVE_KEYS.segments, 'credentials', 'cookie', 'authorization'],
	exactSegments: ['key', 'auth', 'pat'],
	// Settings whose values carry credentials without a credential-shaped key:
	// http.proxy is a URL that may embed user:password@host inline, and the
	// terminal env maps hold environment variables, which are frequently
	// tokens. Whole-key matches on purpose: 'proxy' or 'env' as segment
	// tokens would also redact http.proxySupport, http.proxyStrictSSL, and
	// every *.env.* toggle that carries no secret.
	exactKeys: [
		'http.proxy',
		'terminal.integrated.env.linux',
		'terminal.integrated.env.osx',
		'terminal.integrated.env.windows',
	],
};

/**
 * Whether a setting's value should be redacted because the key suggests it holds
 * a credential or auth token. Only the key's last segment is considered.
 * @param key The full setting key.
 * @param matcher The caller's list of sensitive tokens.
 */
export function matchesSensitiveKey(key: string, matcher: ISensitiveKeyMatcher): boolean {
	if (matcher.exactKeys?.includes(key.toLowerCase())) {
		return true;
	}
	const segment = key.split('.').pop() ?? '';

	// Names arrive in many casings, especially the property names inside object
	// values: apiKey, API_KEY, OPENAI_API_KEY, accessKeyId. Substring tokens
	// match with separators stripped, so api_key reads as apikey.
	const compact = segment.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (matcher.segments.some(sensitive => compact.includes(sensitive))) {
		return true;
	}

	// Exact tokens match any whole word after splitting on separators and
	// camelCase boundaries, so aws_access_key_id and accessKeyId both expose a
	// 'key' word -- while defaultInterpreterPath stays clear ('path' is not
	// 'pat') and sendKeybindingsToShell stays clear ('keybindings' is not
	// 'key'). Whole words on purpose: these tokens are too short to be safe as
	// substrings.
	if (!matcher.exactSegments) {
		return false;
	}
	const words = segment
		.replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(word => word.length > 0);
	return words.some(word => matcher.exactSegments!.includes(word));
}

/**
 * Defense in depth for object-valued settings: the setting's own key can be
 * innocuous while a property inside the value holds the credential, e.g. a
 * GITHUB_TOKEN entry in an env map, or an apiKey property in an options
 * object. Walks the value and replaces every property whose *name* matches
 * the sensitive matcher with the redaction placeholder; property names with
 * no dots are matched whole, so env-var names like AWS_SECRET_ACCESS_KEY hit
 * the same tokens setting keys do. Arrays are walked, primitives pass
 * through. Values come from settings JSON, so there are no cycles to guard.
 * @param value The setting value to walk.
 * @param matcher The caller's list of sensitive tokens.
 * @returns The (possibly rebuilt) value, and whether anything was redacted;
 * when nothing was, `value` is returned as-is.
 */
export function redactSensitiveProperties(value: unknown, matcher: ISensitiveKeyMatcher): { value: unknown; redacted: boolean } {
	if (Array.isArray(value)) {
		let redacted = false;
		const items = value.map(item => {
			const result = redactSensitiveProperties(item, matcher);
			redacted ||= result.redacted;
			return result.value;
		});
		return { value: redacted ? items : value, redacted };
	}
	if (value === null || typeof value !== 'object') {
		return { value, redacted: false };
	}
	let redacted = false;
	const rebuilt: Record<string, unknown> = {};
	for (const [name, propertyValue] of Object.entries(value)) {
		if (matchesSensitiveKey(name, matcher)) {
			rebuilt[name] = REDACTED_VALUE;
			redacted = true;
		} else {
			const result = redactSensitiveProperties(propertyValue, matcher);
			rebuilt[name] = result.value;
			redacted ||= result.redacted;
		}
	}
	return { value: redacted ? rebuilt : value, redacted };
}

/** The scopes at which a configuration value can be explicitly set. */
export interface IExplicitScopes {
	readonly applicationValue?: unknown;
	readonly userValue?: unknown;
	readonly userLocalValue?: unknown;
	readonly userRemoteValue?: unknown;
	readonly workspaceValue?: unknown;
	readonly workspaceFolderValue?: unknown;
	readonly policyValue?: unknown;
}

/**
 * Whether a setting has an explicit value at any target (application, user,
 * workspace, folder, or policy). Policy covers Posit Workbench's enforced
 * settings. A setting left at its registered default reads `undefined`
 * everywhere.
 *
 * Written as explicit `!== undefined` checks rather than a `??` chain: `null` is
 * a legal value in settings.json, and `??` would skip past it and report the
 * setting as untouched.
 */
export function hasExplicitValue(inspected: IExplicitScopes): boolean {
	return inspected.applicationValue !== undefined
		|| inspected.userValue !== undefined
		|| inspected.userLocalValue !== undefined
		|| inspected.userRemoteValue !== undefined
		|| inspected.workspaceValue !== undefined
		|| inspected.workspaceFolderValue !== undefined
		|| inspected.policyValue !== undefined;
}
