/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Finding } from './finding.ts';

export interface Area { name: string; helpers: string[]; focus: string }

export function isoWeek(d: Date): number {
	const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
	t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
	return Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}

/** The week's area, unless a recent smoke finding that held up (fixed or product) points at one. */
export function pickArea(areas: Area[], week: number, recent: Finding[]): { area: Area; why: string } {
	const hits = recent.filter(f => f.source === 'smoke' && (f.outcome === 'fixed' || f.outcome === 'product'))
		.sort((a, b) => (b.reproductions[0]?.at ?? '').localeCompare(a.reproductions[0]?.at ?? ''));
	for (const f of hits) {
		const area = areas.find(a => a.helpers.includes(f.helper));
		if (area) { return { area, why: `recent smoke finding ${f.id} (${f.helper}, ${f.outcome})` }; }
	}
	const area = areas[week % areas.length];
	return { area, why: `ISO week ${week}` };
}
