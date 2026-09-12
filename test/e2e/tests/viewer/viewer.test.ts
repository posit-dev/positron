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

	test('R - Verify Viewer navigates HTML output history', {
		tag: [tags.WEB, tags.ARK, tags.CROSS_BROWSER]
	}, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rReactableHistoryFirstScript);
		await viewer.expectContentVisible(frame => frame.getByText('first-result'));

		await console.executeCode('R', rReactableHistorySecondScript);
		await viewer.expectContentVisible(frame => frame.getByText('second-result'));

		await viewer.showPreviousViewerItem();
		await viewer.expectContentVisible(frame => frame.getByText('first-result'));

		await viewer.showNextViewerItem();
		await viewer.expectContentVisible(frame => frame.getByText('second-result'));
	});

	test('R - Verify Viewer displays reprex code output', {
		tag: [tags.WEB, tags.ARK, tags.CROSS_BROWSER]
	}, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rReprexScript);
		await viewer.expectContentVisible(frame => frame.getByText('rbinom'));
	});

	// The Viewer serves app content (Shiny, Dash, etc.) from a local web server,
	// which is a separate origin from the webview. Copying a selection out of
	// that cross-origin frame is what regressed. A same-origin page (plain HTML)
	// does not exercise the bug, so this serves the probe text over HTTP.
	test('Python - Verify selected text can be copied from the Viewer', { tag: [tags.WIN] }, async function ({ app, python }) {
		const { console, viewer, clipboard, hotKeys } = app.workbench;

		await console.executeCode('Python', pythonViewerServerScript);
		await viewer.expectViewerPanelVisible();
		await viewer.expectContentVisible(frame => frame.getByText(VIEWER_COPY_PROBE));

		// Seed the clipboard so a failed copy leaves a value that clearly isn't
		// the selected text.
		await clipboard.setClipboardText('__SEED__');

		await expect(async () => {
			// Double-click focuses the webview frame and selects the word, so
			// Ctrl/Cmd+C is dispatched to the Viewer content and not the console.
			await viewer.getViewerFrame().getByText(VIEWER_COPY_PROBE).dblclick();
			await hotKeys.copy();
			expect(await clipboard.getClipboardText()).toContain(VIEWER_COPY_PROBE);
		}).toPass({ timeout: 15000 });
	});

	// A Shiny app is served from its own local web server, the real-world case
	// the copy fix targets. Copy the probe out of the Viewer and paste it into an
	// editor, matching what a user actually does, rather than only reading the
	// clipboard API.
	test('R - Verify selected text can be copied from a Shiny app in the Viewer', {
		tag: [tags.ARK, tags.WIN]
	}, async function ({ app, page, r }) {
		const { console, viewer, editors, clipboard, hotKeys } = app.workbench;

		// runApp blocks the console, so paste and run it rather than waiting for
		// a returned prompt.
		await console.pasteCodeToConsole(rViewerShinyScript);
		await console.sendEnterKey();
		await viewer.expectViewerPanelVisible();
		await viewer.expectContentVisible(frame => frame.getByText(VIEWER_COPY_PROBE));

		// Seed the clipboard so a no-op copy can't pass on a probe left behind by
		// an earlier test.
		await clipboard.setClipboardText('__SEED__');

		// Double-click focuses the webview frame and selects the word, then copy.
		await viewer.getViewerFrame().getByText(VIEWER_COPY_PROBE).dblclick();
		await hotKeys.copy();

		// Click the console to pull focus out of the webview (which otherwise
		// swallows shortcuts), open an editor, and paste. This checks the copied
		// text actually pastes, not just that it reached the clipboard API.
		await console.activeConsole.click();
		await editors.newUntitledFile();
		await page.locator('.monaco-editor[data-uri$="Untitled-1"] .view-lines').click();
		await hotKeys.paste();
		await editors.expectEditorToContain(VIEWER_COPY_PROBE);

		// runApp is still blocking the console; interrupt it so the session is
		// left at a prompt and the file stays safe to extend.
		await console.interruptExecution();
	});
});

// A single word so a double-click selects the whole token. Avoid the substring
// "Viewer" so it doesn't collide with the Viewer tab in accessible-name lookups.
const VIEWER_COPY_PROBE = 'PositronCopyProbeToken';

// Serve the probe text from an ephemeral local web server and open it in the
// Viewer, mimicking how a Shiny/Dash/Flask app is served from its own origin.
// Kept free of indented blocks so the file stays tab-indented for hygiene.
const pythonViewerServerScript = `import http.server, socketserver, threading, webbrowser, tempfile, os, functools
_dir = tempfile.mkdtemp()
open(os.path.join(_dir, "index.html"), "w").write("<!doctype html><html><body><p>${VIEWER_COPY_PROBE}</p></body></html>")
_srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=_dir))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
webbrowser.open(f"http://127.0.0.1:{_srv.server_address[1]}")`;

// Run a minimal Shiny app whose only content is the probe word, opened in the
// Viewer the same way any Shiny app is. Kept to a single call so the console
// does not wait on a multi-line block.
const rViewerShinyScript = `shiny::runApp(shiny::shinyApp(ui = shiny::fluidPage(shiny::p("${VIEWER_COPY_PROBE}")), server = function(input, output) {}))`;

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

const rReactableHistoryFirstScript = `reactable::reactable(data.frame(result = "first-result"))`;

const rReactableHistorySecondScript = `reactable::reactable(data.frame(result = "second-result"))`;

const rReprexScript = `reprex::reprex(rbinom(3, size = 10, prob = 0.5), comment = "#;-)")`;
