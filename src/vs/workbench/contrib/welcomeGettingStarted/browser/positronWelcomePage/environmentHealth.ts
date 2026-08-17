/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';

// Core's copy of what `python.getEnvironmentHealth` and `r.getEnvironmentHealth`
// return. Core cannot import from an extension, so this mirrors their shape by
// hand and `isEnvironmentHealthResult` guards the boundary.

export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

/**
 * The same statuses again, as values this time, so a payload that crossed the
 * extension host as JSON can be checked against them. Typed as the union above,
 * so a status that is not one of them does not compile.
 */
const HEALTH_ITEM_STATUSES: readonly HealthItemStatus[] = ['pass', 'warn', 'fail', 'skipped'];

function isHealthItemStatus(value: unknown): value is HealthItemStatus {
	return typeof value === 'string'
		&& HEALTH_ITEM_STATUSES.some(status => status === value);
}

export interface IHealthItemFix {
	readonly commandId: string;
	readonly args?: readonly unknown[];
	readonly label: string;
}

export interface IHealthItem {
	/** Machine id, not shown to the user. */
	readonly id: string;
	readonly status: HealthItemStatus;
	/** The title of the step, shown to the user. */
	readonly summary: string;
	readonly detail?: string;
	readonly fix?: IHealthItemFix;
	readonly learnMoreUrl?: string;
}

export interface IEnvironmentHealthResult {
	/**
	 * True when nothing failed, so a warning still reports true.
	 *
	 * Nothing reads the value -- every question the UI asks is answered by the item
	 * statuses -- but `isEnvironmentHealthResult` still requires it to be present
	 * and a boolean, as a cheap signal that the payload came from a command that
	 * knows this contract. Do not delete that check as dead weight.
	 */
	readonly ok: boolean;
	/** The full set, in dependency order, with skipped items after the first failure. */
	readonly items: readonly IHealthItem[];
}

export type HealthLanguage = 'python' | 'r';

export interface ILanguageHealthSource {
	readonly language: HealthLanguage;
	readonly label: string;
	readonly extensionId: string;
	/** The command that runs this language's environment health check. */
	readonly healthCheckCommandId: string;
}

// Owned by the extensions, not by this file. If either renames one, this is the
// single place that has to follow.
const PYTHON_EXTENSION_ID = 'ms-python.python';
const PYTHON_HEALTH_CHECK_COMMAND_ID = 'python.getEnvironmentHealth';
const R_EXTENSION_ID = 'positron.positron-r';
const R_HEALTH_CHECK_COMMAND_ID = 'r.getEnvironmentHealth';

/** The only place that names specific extensions. Rendered in this order. */
export const HEALTH_SOURCES: readonly ILanguageHealthSource[] = [
	{
		language: 'python',
		label: localize('positron.welcome.environmentSetupPython', "Python"),
		extensionId: PYTHON_EXTENSION_ID,
		healthCheckCommandId: PYTHON_HEALTH_CHECK_COMMAND_ID,
	},
	{
		language: 'r',
		label: localize('positron.welcome.environmentSetupR', "R"),
		extensionId: R_EXTENSION_ID,
		healthCheckCommandId: R_HEALTH_CHECK_COMMAND_ID,
	},
];

function isHealthItem(value: unknown): value is IHealthItem {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const item = value as Partial<IHealthItem>;
	// `fix` is checked because a broken one is handed straight to executeCommand.
	// A missing or non-string command id gets called anyway, and an id that is not
	// a registered command sends CommandService down its activate-everything path,
	// which waits 30 seconds before rejecting. This cannot tell whether an id is
	// registered -- any string passes -- only that there is one to call. The label
	// is checked for the same reason: it is the only thing telling the user what
	// the button will do, and a missing one renders a button reading "undefined"
	// that runs a real command.
	//
	// Null is checked alongside undefined because this crossed the extension host
	// as JSON, where an explicit null survives and an undefined does not. Both
	// mean the item has no fix.
	const fix = item.fix;
	if (fix !== undefined && fix !== null
		&& (typeof fix.commandId !== 'string' || typeof fix.label !== 'string')) {
		return false;
	}
	return typeof item.id === 'string'
		&& typeof item.summary === 'string'
		&& isHealthItemStatus(item.status);
}

/**
 * Checks a payload that crossed the extension host boundary as plain JSON.
 *
 * Shallow on purpose, with two specific requirements. `items` must be non-empty,
 * because the collapse rule uses `items.every(...)` and would call an empty
 * result a success. Unknown properties are ignored rather than rejected: each
 * language adds its own extras that nothing here reads.
 */
export function isEnvironmentHealthResult(value: unknown): value is IEnvironmentHealthResult {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const result = value as Partial<IEnvironmentHealthResult>;
	return typeof result.ok === 'boolean'
		&& Array.isArray(result.items)
		&& result.items.length > 0
		&& result.items.every(isHealthItem);
}
