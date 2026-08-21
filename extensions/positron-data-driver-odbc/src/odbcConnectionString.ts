/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Building, parsing, and redacting ODBC connection strings.
//
// The format is `KEY=VALUE;KEY=VALUE`, which looks trivial and is not: a value containing a
// semicolon has to be brace-wrapped, and a brace inside a brace-wrapped value has to be doubled.
// Passwords routinely contain both. Everything that assembles a connection string goes through
// buildConnectionString so the escaping is done once, correctly.

/** The attribute names that hold a secret. Used when redacting for display. */
const SECRET_KEYS = ['PWD', 'PASSWORD'];

/** The mask substituted for a password when redacting a connection string. */
const REDACTED_PASSWORD = '****';

/**
 * The characters that oblige a connection string value to be brace-wrapped, from the ODBC
 * specification. Driver names routinely contain several of them -- "PostgreSQL Unicode(x64)" has
 * parentheses, and a password is free to contain anything at all.
 */
const VALUE_NEEDS_BRACES = /[[\]{}(),;?*=!@]/;

/**
 * The attribute names always written brace-wrapped, whatever their value.
 *
 * Only the driver name. It is quoted this way universally -- every vendor's documentation shows
 * `Driver={...}` -- and some drivers parse it loosely enough that an unbraced name containing a
 * space goes wrong. A DSN name is conventionally written bare (`DSN=Pagila`) and only needs bracing
 * when it contains something from VALUE_NEEDS_BRACES, which the general rule already covers.
 */
const ALWAYS_BRACED_KEYS = new Set(['driver']);

/**
 * Escapes one connection string value. A closing brace inside a brace-wrapped value is doubled,
 * which is how the ODBC specification says to escape it.
 * @param value The raw value, unbraced.
 * @param forceBraces Whether to wrap even when the value contains nothing that requires it.
 */
function escapeValue(value: string, forceBraces: boolean): string {
	const needsBraces = forceBraces || VALUE_NEEDS_BRACES.test(value) || value !== value.trim();
	if (!needsBraces) {
		return value;
	}
	return `{${value.replace(/\}/g, '}}')}}`;
}

/**
 * Builds a connection string from attributes, skipping any whose value is undefined or empty. Order
 * is preserved, so callers can put `DSN` or `Driver` first, where drivers expect it.
 *
 * Values are passed in raw -- callers must not pre-wrap them in braces, or they will be wrapped
 * twice.
 * @param attributes The attribute name/value pairs, in the order they should appear.
 */
export function buildConnectionString(attributes: ReadonlyArray<readonly [string, string | number | undefined]>): string {
	return attributes
		.filter((entry): entry is [string, string | number] => {
			const value = entry[1];
			return value !== undefined && String(value).length > 0;
		})
		.map(([key, value]) => `${key}=${escapeValue(String(value), ALWAYS_BRACED_KEYS.has(key.toLowerCase()))}`)
		.join(';');
}

/**
 * Parses a connection string into its attributes, keyed by lowercased name. Understands the
 * brace-wrapped form produced by buildConnectionString. Malformed input yields whatever could be
 * read rather than throwing: this is used to *describe* a string the user pasted, and a partial
 * description beats none.
 *
 * Exported for tests.
 */
export function parseConnectionString(connectionString: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	let index = 0;

	while (index < connectionString.length) {
		// Read the key up to '='.
		const equals = connectionString.indexOf('=', index);
		if (equals === -1) {
			break;
		}
		const key = connectionString.slice(index, equals).trim().toLowerCase();
		index = equals + 1;

		let value: string;
		if (connectionString[index] === '{') {
			// Brace-wrapped: scan to the closing brace, treating '}}' as an escaped '}'.
			index++;
			let scanned = '';
			while (index < connectionString.length) {
				if (connectionString[index] === '}') {
					if (connectionString[index + 1] === '}') {
						scanned += '}';
						index += 2;
						continue;
					}
					index++;
					break;
				}
				scanned += connectionString[index++];
			}
			value = scanned;
			// Skip the separator after the closing brace.
			const semicolon = connectionString.indexOf(';', index);
			index = semicolon === -1 ? connectionString.length : semicolon + 1;
		} else {
			const semicolon = connectionString.indexOf(';', index);
			const end = semicolon === -1 ? connectionString.length : semicolon;
			value = connectionString.slice(index, end).trim();
			index = semicolon === -1 ? connectionString.length : semicolon + 1;
		}

		if (key.length > 0) {
			attributes[key] = value;
		}
	}

	return attributes;
}

/**
 * Produces a display-safe form of a connection string by masking the embedded password, used as
 * the field placeholder when editing a saved connection-string connection. Everything else is
 * preserved verbatim, so the user can still read back what they pasted.
 */
export function redactConnectionString(connectionString: string): string {
	// Masked in place rather than by parsing and rebuilding: this is shown back to the user as the
	// field's placeholder, so the rest of the string should read exactly as they typed it, keeping
	// their own capitalization, spacing, and bracing.
	// A value is either brace-wrapped (with `}}` for an embedded brace) or runs to the next semicolon.
	const secretValue = new RegExp(`(^|;)(\\s*(?:${SECRET_KEYS.join('|')})\\s*=\\s*)(\\{(?:[^}]|\\}\\})*\\}|[^;]*)`, 'gi');
	return connectionString.replace(
		secretValue,
		(_match, separator: string, keyAndEquals: string) => `${separator}${keyAndEquals}${REDACTED_PASSWORD}`
	);
}

/**
 * Extracts the ODBC driver name a connection string will use, for resolving the SQL dialect. A
 * string built against a DSN names the DSN rather than the driver, so the DSN's own `Driver` has to
 * be looked up separately by the caller; this returns the `Driver` attribute when the string
 * carries one, and the `DSN` name otherwise.
 */
export function describeConnectionTarget(connectionString: string): { driverName?: string; dsnName?: string } {
	const attributes = parseConnectionString(connectionString);
	return { driverName: attributes['driver'], dsnName: attributes['dsn'] };
}
