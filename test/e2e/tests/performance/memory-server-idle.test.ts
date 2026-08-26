/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../_test.setup';
import { defineMemoryScenario } from './memory-scenario';

test.use({
	suiteId: __filename
});

// Tagged @:web because it genuinely runs in web mode: that is what makes it
// eligible in e2e-chromium, which takes the spawned-server path and so gives the
// collector a process tree to walk. playwright.config.ts keeps it out of every
// ordinary @:web run via memorySpecsToIgnore.
//
// No expectRoles: the server tree has no renderer or gpu (both are in the
// browser, outside this tree), and asserting the roles it does have would only
// restate what the report already shows.
defineMemoryScenario({ scenario: 'idle', lane: 'server', tag: tags.WEB });
