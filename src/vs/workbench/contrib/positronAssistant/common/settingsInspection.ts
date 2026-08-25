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
};

/**
 * Whether a setting's value should be redacted because the key suggests it holds
 * a credential or auth token. Only the key's last segment is considered.
 * @param key The full setting key.
 * @param matcher The caller's list of sensitive tokens.
 */
export function matchesSensitiveKey(key: string, matcher: ISensitiveKeyMatcher): boolean {
	const segment = key.split('.').pop()?.toLowerCase() ?? '';
	return matcher.segments.some(sensitive => segment.includes(sensitive))
		|| (matcher.exactSegments?.includes(segment) ?? false);
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
