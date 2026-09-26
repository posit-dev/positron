/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Bottom Panel Size', {
	tag: [tags.LAYOUTS]
}, () => {

	test('Panel size is kept after visiting a project with no open editors', {
		annotation: [
			{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/2033' },
		],
	}, async function ({ app, openFile, openFolder }) {
		const layouts = app.workbench.layouts;

		// An empty sibling project: it opens with no editors, so the panel is maximized there
		const otherFolder = 'panel-size-other-project';
		fs.mkdirSync(path.join(path.dirname(app.workspacePathOrFolder), otherFolder), { recursive: true });

		// Open a file and give the panel a custom height
		await openFile('README.md');
		await layouts.resizePanelToHeight(200);
		const panelHeight = await layouts.boundingBoxProperty(layouts.panel, 'height');

		// Switch to the empty project and back
		await openFolder(otherFolder);
		await openFolder(path.basename(app.workspacePathOrFolder));

		// The panel should be restored to the custom height
		await expect.poll(async () =>
			Math.abs(await layouts.boundingBoxProperty(layouts.panel, 'height') - panelHeight)
		).toBeLessThanOrEqual(1);
	});
});
