/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { prepareForScreenshot } from './helpers/layout-utils';
import { annotate } from './helpers/annotate-utils';
import { join } from 'path';

test.use({
	suiteId: __filename,
});

/**
 * Screenshot: annotated layout overview
 * Path: https://positron.posit.co/layout.html
 *
 * POC for in-image annotation. Workspace state is intentionally simple here
 * (default Welcome view); a follow-up will swap in the positron-workshop /
 * hello.qmd state shown in the live docs.
 */
test.describe('Release screenshots - Layout', () => {
	test('annotated layout', async ({ app, page, r, openFile }) => {
		await openFile(join('workspaces', 'astropy-testing', 'plot_galactocentric_frame.py'));

		await prepareForScreenshot(app, page);
		await annotate(page, [
			{ selector: '.activitybar', label: 'Activity bar', color: '#16a34a' },
			{ selector: '.part.sidebar', label: 'Primary side bar', color: '#ca8a04', labelPosition: 'top-center' },
			{ selector: '.part.editor', label: 'Editor', color: '#7c3aed' },
			{ selector: '.part.auxiliarybar', label: 'Secondary side bar', color: '#ea580c' },
			{ selector: '.part.panel', label: 'Panel', color: '#0d9488' },
		]);
		await captureFullWindow(page, 'layout.png');
	});
});
