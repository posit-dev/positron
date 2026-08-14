/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { walkthroughs } from '../../common/gettingStartedContent.js';
import { isHiddenWalkthrough } from '../../common/positronHiddenWalkthroughs.js';

describe('isHiddenWalkthrough', function () {
	it('reports which walkthroughs Positron hides and which it keeps', () => {
		const ids = [
			// Hidden: upstream content that describes VS Code, not Positron.
			'Setup',
			'SetupWeb',
			'Beginner',
			'ms-python.python#pythonWelcome',
			'ms-python.python#pythonDataScienceWelcome',
			// Extension IDs are case insensitive, and extensions declare them
			// inconsistently, so Copilot must match in either casing.
			'GitHub.copilot-chat#copilotWelcome',
			'github.copilot-chat#copilotWelcome',
			// Kept: Positron-authored walkthroughs and upstream accessibility.
			'SetupAccessibility',
			'notebooks.welcome',
			'ms-python.python#positron.migrateFromVSCode',
			'positron.positron-r#positron.r.migrateFromRStudio',
			// Extension walkthroughs are matched on the full qualified ID, so
			// the bare form of a hidden ID must not match.
			'pythonWelcome',
			// The walkthrough half of the ID stays case sensitive, unlike the
			// extension half.
			'github.copilot-chat#copilotwelcome',
		];

		const hiddenById = Object.fromEntries(ids.map(id => [id, isHiddenWalkthrough(id)]));

		expect(hiddenById).toMatchInlineSnapshot(`
			{
			  "Beginner": true,
			  "GitHub.copilot-chat#copilotWelcome": true,
			  "Setup": true,
			  "SetupAccessibility": false,
			  "SetupWeb": true,
			  "github.copilot-chat#copilotWelcome": true,
			  "github.copilot-chat#copilotwelcome": false,
			  "ms-python.python#positron.migrateFromVSCode": false,
			  "ms-python.python#pythonDataScienceWelcome": true,
			  "ms-python.python#pythonWelcome": true,
			  "notebooks.welcome": false,
			  "positron.positron-r#positron.r.migrateFromRStudio": false,
			  "pythonWelcome": false,
			}
		`);
	});

	it('hides exactly the intended walkthroughs from the built-in content module', () => {
		// Reads the real built-in walkthrough list rather than a copy of it, so
		// this fails if an upstream merge renames or removes one of the IDs we
		// hide. A stale ID would otherwise hide nothing, silently.
		const hidden = walkthroughs.map(walkthrough => walkthrough.id).filter(isHiddenWalkthrough);

		expect(hidden).toMatchInlineSnapshot(`
			[
			  "Setup",
			  "SetupWeb",
			  "Beginner",
			]
		`);
	});
});
