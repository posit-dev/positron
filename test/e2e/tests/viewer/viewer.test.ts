/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Viewer', { tag: [tags.VIEWER, tags.CONSOLE] }, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.viewer.clearViewer();
	});

	test('Python - Verify Viewer opens for WebBrowser calls', async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonScript);
		await viewer.expectViewerPanelVisible();
		await viewer.expectUrlToHaveValue('http://127.0.0.1:8000/');
	});

	// Only web renders the preview iframe via an HTML string (previewOverlayWebview.ts);
	// Electron navigates the webview directly and never produces a #preview-iframe element.
	test('Python - Verify Viewer preserves query params through HTML embedding', { tag: [tags.WEB_ONLY] },
		async function ({ app, python }) {
			const { console, viewer } = app.workbench;

			// `&not;` is a terminated legacy HTML character reference (decodes to the "not
			// sign" character) that browsers resolve unconditionally inside an unescaped
			// HTML attribute. If the iframe's `src` isn't HTML-attribute-encoded, this query
			// string is corrupted before the iframe ever sees it.
			await console.executeCode('Python', pythonQueryParamScript);
			await viewer.expectViewerPanelVisible();
			// The origin is environment-dependent: the web server rewrites localhost URLs
			// to its port-forwarding proxy (e.g. http://localhost:9000/proxy/8000/), so
			// only assert on the query string.
			await expect(viewer.getViewerLocator('#preview-iframe')).toHaveAttribute(
				'src', /\/\?a=1&not;b=2&_positronRender=[0-9a-f]+$/
			);
		});

	// note: this test is skipped on firefox - it fails
	test('Python - Verify Viewer displays great-tables', { tag: [tags.WEB, tags.CROSS_BROWSER] },
		async function ({ app, python }) {
			const { console, viewer } = app.workbench;

			await console.executeCode('Python', pythonGreatTablesScript);
			await viewer.expectContentVisible(frame => frame.getByRole('cell', { name: 'apricot' }), { useIframe: false });
		});

	test('R - Verify Viewer displays modelsummary output', {
		tag: [tags.WEB, tags.ARK, tags.CROSS_BROWSER]
	}, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rModelSummaryScript);
		// await viewer.expectContentVisible(frame => frame.getByRole('cell', { name: 'bill_depth_mm' }));
		await viewer.expectContentVisible(frame => frame.locator('tr').filter({ hasText: 'bill_depth_mm' }));
	});

	test('R - Verify Viewer displays reactable table output', {
		tag: [tags.WEB, tags.ARK, tags.CROSS_BROWSER]
	}, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rReactableScript);
		await viewer.expectContentVisible(frame => frame.getByText('Datsun 710'));
	});

	test('R - Verify Viewer displays reprex code output', {
		tag: [tags.WEB, tags.ARK, tags.CROSS_BROWSER]
	}, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rReprexScript);
		await viewer.expectContentVisible(frame => frame.getByText('rbinom'));
	});
});

const pythonScript = `import webbrowser
# will not have any content, but we just want to make sure
# the viewer will open when webbrowser calls are made
webbrowser.open('http://127.0.0.1:8000')`;

const pythonQueryParamScript = `import webbrowser
# will not have any content, but we just want to make sure the
# query string survives being embedded in the preview iframe's src
webbrowser.open('http://127.0.0.1:8000/?a=1&not;b=2')`;

const pythonGreatTablesScript = `from great_tables import GT, exibble
GT(exibble)`;

const rModelSummaryScript = `library(palmerpenguins)
library(fixest)
library(modelsummary)
m1 = feols(body_mass_g ~ bill_depth_mm + bill_length_mm | species, data = penguins)
modelsummary(m1)`;

const rReactableScript = `library(reactable)
mtcars |> reactable::reactable()`;

const rReprexScript = `reprex::reprex(rbinom(3, size = 10, prob = 0.5), comment = "#;-)")`;
