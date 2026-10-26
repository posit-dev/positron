/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failures, groupLeads, normalizeError, splitCommand } from './leads-lib.ts';

// Cut from a real run's actions.log (37707094533).
const LOG = `2026-10-08T00:43:21Z ui.sh -s=cold2: read dialog: dialog "Folder Template" | radio "Python Project"
2026-10-08T00:43:29Z ui.sh -s=cold2: FAILED click radio 'Python Project' --in dialog: no visible radio "Python Project" in dialog; a modal dialog is open: "Folder Template"
2026-10-08T00:43:30Z ui.sh -s=cold2: FAILED click button Next --in dialog: button "Next" in dialog is disabled; nothing was done
2026-10-08T00:43:46Z click: Python Project tile in the Folder Template dialog
2026-10-08T00:44:03Z ui.sh -s=cold2: FAILED choose button 'Venv Use a Python version' uv --in dialog: no item "uv" in the menu or popup
2026-10-08T00:44:06Z ui.sh -s=cold2: read dialog: dialog "Python Environment"
2026-10-08T00:44:14Z ui.sh -s=cold2: choose "button" "Venv Use a Python version" "uvUse uv" in dialog -> trigger Venv -> uv
2026-10-08T00:44:29Z palette-run.sh -s=cold2: FAILED 'Workspaces: New Folder from Template...': the Command Palette did not open
2026-10-08T00:44:31Z shot.sh -s=cold2: screenshot S05-01.png
`;

test('splitCommand skips a colon inside quotes', () => {
	assert.deepEqual(splitCommand(`'Workspaces: New Folder...': the Command Palette did not open`), { command: `'Workspaces: New Folder...'`, error: 'the Command Palette did not open' });
});

test('normalizeError drops context, names and numbers', () => {
	assert.equal(normalizeError(`no visible radio "Python Project" in dialog; a modal dialog is open: "X"`), 'no visible radio "_" in dialog');
	assert.equal(normalizeError(`resolved to 2 elements`), 'resolved to N elements');
});

test('failures: first of a streak, and what the agent did next', () => {
	assert.deepEqual(failures(LOG).map(f => [f.key, f.next]), [
		['ui.sh click: no visible radio "_" in dialog', 'by hand'],
		['ui.sh choose: no item "_" in the menu or popup', 'retried'],
		['palette-run.sh: the Command Palette did not open', 'unresolved'],
	]);
});

test('groupLeads ranks by runs, then by how often the agent got past it', () => {
	const leads = groupLeads([{ run: 'a', failures: failures(LOG) }, { run: 'b', failures: failures(LOG).slice(2) }]);
	assert.deepEqual(leads.map(l => [l.key, l.runs]), [
		['palette-run.sh: the Command Palette did not open', ['a', 'b']],
		['ui.sh click: no visible radio "_" in dialog', ['a']],
		['ui.sh choose: no item "_" in the menu or popup', ['a']],
	]);
});

test('failures keep every line of the window, so the finder can tell a block from a detour', () => {
	const click = failures(LOG)[0];
	assert.equal(click.after.length, 6);
	assert.match(click.after[5], /palette-run.sh .*did not open/);
});
