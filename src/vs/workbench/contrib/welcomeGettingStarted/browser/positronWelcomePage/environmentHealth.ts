/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';

/**
 * Core's copy of what `python.getEnvironmentHealth` and `r.getEnvironmentHealth`
 * return. Core cannot import from an extension, so this mirrors their shape by
 * hand and `isEnvironmentHealthResult` guards the boundary.
 */

export type HealthItemStatus = 'pass' | 'warn' | 'fail' | 'skipped';

const HEALTH_ITEM_STATUSES: readonly string[] = ['pass', 'warn', 'fail', 'skipped'];

export interface IHealthItemFix {
	readonly commandId: string;
	readonly args?: readonly unknown[];
	readonly label: string;
}

export interface IHealthItem {
	/**
	 * Machine id. A plain string because the two languages use different sets and
	 * nothing here looks an item up by id.
	 */
	readonly id: string;
	readonly status: HealthItemStatus;
	/** The check's label. Does not vary with the outcome; the icon carries that. */
	readonly summary: string;
	readonly detail?: string;
	readonly fix?: IHealthItemFix;
	readonly learnMoreUrl?: string;
}

export interface IEnvironmentHealthResult {
	/**
	 * True when nothing failed, so a warning still reports true. Nothing reads it:
	 * every question the UI asks is answered by the item statuses.
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
	readonly commandId: string;
}

/** The only place that names specific extensions. Rendered in this order. */
export const HEALTH_SOURCES: readonly ILanguageHealthSource[] = [
	{
		language: 'python',
		label: localize('positron.welcome.health.python', "Python"),
		extensionId: 'ms-python.python',
		commandId: 'python.getEnvironmentHealth',
	},
	{
		language: 'r',
		label: localize('positron.welcome.health.r', "R"),
		extensionId: 'positron.positron-r',
		commandId: 'r.getEnvironmentHealth',
	},
];

function isHealthItem(value: unknown): value is IHealthItem {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const item = value as Partial<IHealthItem>;
	// `fix` gets checked where the others do not, because it is the only field
	// that drives an action rather than a display. An unregistered command id
	// sends CommandService down its activate-everything path, which waits 30
	// seconds before rejecting -- the same wait the extension check in the
	// tracker exists to avoid.
	if (item.fix !== undefined && typeof item.fix?.commandId !== 'string') {
		return false;
	}
	return typeof item.id === 'string'
		&& typeof item.summary === 'string'
		&& typeof item.status === 'string'
		&& HEALTH_ITEM_STATUSES.includes(item.status);
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
