/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SKILL_PREFIX } from './scope.ts';

const REPO = 'https://github.com/posit-dev/positron';

export function candidateBranch(date: Date, runId: string): string {
	return `automated/drive-positron/${date.toISOString().slice(0, 10)}-${runId}`;
}

/** A compare page with the PR form open and filled in. The body is cut to fit `max` and always ends with the run link. */
export function compareUrl(branch: string, title: string, body: string, runUrl: string, max = 8000): string {
	const tail = `\n\nFull run: ${runUrl}`;
	const build = (b: string) => `${REPO}/compare/main...${branch}?expand=1&title=${encodeURIComponent(title)}&body=${encodeURIComponent(b + tail)}`;
	if (build(body).length <= max) { return build(body); }
	// Cut by characters, not by encoded length, so no %XX escape is split.
	let lo = 0, hi = body.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (build(`${body.slice(0, mid)}\n\n(trimmed)`).length <= max) { lo = mid; } else { hi = mid - 1; }
	}
	return build(`${body.slice(0, lo)}\n\n(trimmed)`);
}

export function staleBranches(branches: string[], openHeads: string[], now: Date, days = 14): string[] {
	const cutoff = now.getTime() - days * 86400000;
	return branches.filter(b => {
		const d = b.match(/^automated\/drive-positron\/(\d{4}-\d{2}-\d{2})-/)?.[1];
		return d !== undefined && Date.parse(`${d}T00:00:00Z`) < cutoff && !openHeads.includes(b);
	});
}

export function smokeChecksChanged(paths: string[]): boolean {
	return paths.includes(`${SKILL_PREFIX}test/smoke.ts`);
}
