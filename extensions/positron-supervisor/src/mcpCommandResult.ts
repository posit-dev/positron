/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The most JSON we will hand back for one command. A Positron command can
 * return an unbounded list (every installed package, every variable in the
 * session); pouring that into an agent's context is expensive and rarely what
 * it needed, so results are shed down to this budget.
 */
export const COMMAND_RESULT_BUDGET_BYTES = 32 * 1024;

/**
 * Names the field that was shortened and by how much, so an agent can tell a
 * shortened answer from a complete one and ask a narrower question.
 */
export interface CommandResultTruncation {
	/** The field whose elements were shed. */
	field: string;

	/** How many elements survived. */
	returned: number;

	/** How many there were. */
	total: number;
}

/** The serialized size of a value, in bytes. */
function sizeOf(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value) ?? 'null');
}

/** Whether a value is a plain object we can copy field by field. */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The longest prefix of `items` that fits in the remaining budget.
 *
 * @param items The array to shorten.
 * @param overhead The bytes the rest of the result already accounts for.
 * @returns The elements that fit.
 */
function fittingPrefix(items: unknown[], overhead: number): unknown[] {
	const kept: unknown[] = [];
	// Two bytes for the brackets, then one per separating comma.
	let used = overhead + 2;
	for (const item of items) {
		const cost = sizeOf(item) + (kept.length ? 1 : 0);
		if (used + cost > COMMAND_RESULT_BUDGET_BYTES) {
			break;
		}
		used += cost;
		kept.push(item);
	}
	return kept;
}

/**
 * Shrinks a command result to {@link COMMAND_RESULT_BUDGET_BYTES}, shedding
 * elements from its largest array rather than cutting the JSON mid-string, so
 * what comes back still parses.
 *
 * @param result The command's return value.
 * @returns The result, or a shortened stand-in carrying a `truncated` field.
 */
export function budgetCommandResult(result: unknown): unknown {
	if (sizeOf(result) <= COMMAND_RESULT_BUDGET_BYTES) {
		return result;
	}

	// A bare array has no room for the `truncated` marker, so it is wrapped.
	if (Array.isArray(result)) {
		const truncated: CommandResultTruncation = { field: 'items', returned: 0, total: result.length };
		const items = fittingPrefix(result, sizeOf({ items: [], truncated }));
		truncated.returned = items.length;
		return { items, truncated };
	}

	if (isRecord(result)) {
		// Shed from the longest array field: it is the one that made the result
		// too big, and the other fields are usually the summary an agent wants.
		let field: string | undefined;
		let longest = 0;
		for (const [key, value] of Object.entries(result)) {
			if (Array.isArray(value) && value.length > longest) {
				field = key;
				longest = value.length;
			}
		}
		if (field !== undefined) {
			const original = result[field] as unknown[];
			const truncated: CommandResultTruncation = { field, returned: 0, total: original.length };
			const items = fittingPrefix(
				original, sizeOf({ ...result, [field]: [], truncated }));
			truncated.returned = items.length;
			return { ...result, [field]: items, truncated };
		}
	}

	// Nothing structural to shed: a long string, or an object of scalars.
	return {
		truncated: { field: 'result', returned: 0, total: 1 } satisfies CommandResultTruncation,
		message: `The command returned ${sizeOf(result)} bytes, over the ` +
			`${COMMAND_RESULT_BUDGET_BYTES} byte limit, in a shape that cannot be shortened. ` +
			`Ask for less, or run the equivalent code with execute_code.`,
	};
}
