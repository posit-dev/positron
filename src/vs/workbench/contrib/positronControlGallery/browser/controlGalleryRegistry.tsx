/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactElement } from 'react';

/**
 * ControlGalleryEntry interface. One entry corresponds to a single control's harness panel in the
 * Control Gallery. Entries are registered into the singleton registry via side-effect imports from
 * a barrel file, which keeps the per-control harness file self-contained and adding a new control
 * a one-line change to the barrel.
 */
export interface ControlGalleryEntry {
	// Stable identifier, used as the React key and for selection state.
	readonly id: string;

	// Human-readable label shown in the navigation list.
	readonly label: string;

	// Optional one-line description shown beside the label.
	readonly description?: string;

	// Renders the harness panel. Called whenever the entry becomes selected.
	readonly render: () => ReactElement;
}

/**
 * ControlGalleryRegistry. Holds the set of registered gallery entries in registration order.
 */
class ControlGalleryRegistry {
	private readonly _entries: ControlGalleryEntry[] = [];

	register(entry: ControlGalleryEntry): void {
		if (this._entries.some(e => e.id === entry.id)) {
			throw new Error(`Control gallery entry with id '${entry.id}' is already registered.`);
		}
		this._entries.push(entry);
	}

	getEntries(): readonly ControlGalleryEntry[] {
		return this._entries;
	}
}

export const controlGalleryRegistry = new ControlGalleryRegistry();
