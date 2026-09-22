/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** A command argument, as the agent command catalog describes it. */
export interface CommandArgSpec {
	name: string;
	schema?: object;
}

/**
 * Check the arguments an agent supplied against a command's catalog entry
 * before running it: each must have a JSON type its schema allows. Only the
 * schema's `type` is checked, which is as far as the catalog's schemas go in
 * practice. Missing arguments are not refused: the catalog marks an argument
 * required unless its command says otherwise, and most commands with optional
 * arguments don't.
 *
 * @param specs The command's arguments, in positional order.
 * @param args The arguments the agent supplied.
 * @returns Why the arguments were refused, or undefined when they pass.
 */
export function checkCommandArgs(
	specs: readonly CommandArgSpec[],
	args: readonly unknown[],
): string | undefined {
	for (const [index, spec] of specs.entries()) {
		const value = args[index];
		// A null holds the place of an argument that is not given.
		if (value === undefined || value === null) {
			continue;
		}
		const allowed = schemaTypes(spec.schema);
		if (allowed.length > 0 && !allowed.some(type => hasType(value, type))) {
			return `Argument '${spec.name}' must be ${allowed.join(' or ')}, not ${jsonType(value)}`;
		}
	}
	return undefined;
}

/** The types a JSON Schema's `type` keyword allows. */
function schemaTypes(schema: object | undefined): string[] {
	const type = (schema as { type?: unknown } | undefined)?.type;
	return (Array.isArray(type) ? type : [type]).filter((t): t is string => typeof t === 'string');
}

/** A value's JSON type. */
function jsonType(value: unknown): string {
	return Array.isArray(value) ? 'array' : typeof value;
}

/** Whether a value has a JSON Schema type. */
function hasType(value: unknown, type: string): boolean {
	return jsonType(value) === type || (type === 'integer' && Number.isInteger(value));
}
