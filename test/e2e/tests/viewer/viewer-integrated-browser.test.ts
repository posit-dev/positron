/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// On Desktop, the Viewer can show web pages in the integrated browser, a
// native view, instead of a webview. The page is then its own Playwright page,
// which the Viewer page object finds.
test.describe('Viewer: Integrated Browser', { tag: [tags.VIEWER] }, () => {

	test.beforeAll(async ({ settings }) => {
		await settings.set({ 'viewer.useIntegratedBrowser': true });
	});

	test.afterAll(async ({ settings }) => {
		await settings.remove(['viewer.useIntegratedBrowser']);
	});

	test.afterEach(async function ({ app, hotKeys }) {
		await hotKeys.closeAllEditors();
		await app.workbench.viewer.clearViewer();
	});

	test('Python - Verify a page in the integrated browser can be used and navigated', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));
		expect(await viewer.usesIntegratedBrowser()).toBe(true);
		const page = await viewer.getBrowserPage();
		const origin = new URL(page.url()).origin;
		await viewer.expectUrlToHaveValue(`${origin}/index.html`);

		await test.step('Reload discards what the page did', async () => {
			await page.getByRole('button', { name: 'Mark' }).click();
			await expect(page.getByText('Marked')).toBeVisible();
			await viewer.refreshViewer();
			await expect(page.getByText('Marked')).toHaveCount(0);
		});

		await test.step('Following a link and going back tracks the URL', async () => {
			await page.getByRole('link', { name: 'Page two' }).click();
			await expect(page.getByRole('heading', { name: 'Page Two' })).toBeVisible();
			await viewer.expectUrlToHaveValue(`${origin}/page2.html`);
			await viewer.navigateBack();
			await expect(page.getByRole('heading', { name: 'Page One' })).toBeVisible();
			await viewer.expectUrlToHaveValue(`${origin}/index.html`);
		});
	});

	// The integrated browser exists to fix copying out of apps in the Viewer,
	// which the webview's cross-origin frames broke.
	test('Python - Verify selected text can be copied from the integrated browser', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer, clipboard } = app.workbench;

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByText(COPY_PROBE));
		const page = await viewer.getBrowserPage();

		// Seed the clipboard so a failed copy leaves a value that clearly isn't
		// the selected text.
		await clipboard.setClipboardText('__SEED__');
		await expect(async () => {
			await page.getByText(COPY_PROBE).dblclick();
			await page.keyboard.press('ControlOrMeta+c');
			expect(await clipboard.getClipboardText()).toContain(COPY_PROBE);
		}).toPass({ timeout: 15000 });
	});

	test('Python - Verify agents can read and act on the page in the integrated browser', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));

		const outline = await app.code.driver.executeCommand<string>('positronViewer.read', { interactiveOnly: true });
		expect(outline).toContain('backend="browser"');
		const ref = /button "Mark" \[ref=(?<ref>e\d+)\]/.exec(outline)?.groups?.ref;
		expect(ref).toBeDefined();

		const result = await app.code.driver.executeCommand<string>('positronViewer.click', { ref });
		expect(result).toContain('Clicked the button "Mark".');
		await expect((await viewer.getBrowserPage()).getByText('Marked')).toBeVisible();
	});

	test('Python - Verify DevTools open for the page in the integrated browser', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));

		const toggle = app.code.driver.currentPage.getByRole('button', { name: 'Toggle Developer Tools' });
		const devTools = await app.code.driver.waitForNewPage('devtools://', () => toggle.click());
		expect(devTools.url()).toContain('devtools://');
		await toggle.click();
	});

	// An htmlwidget is an HTML file the R session asks the Viewer to show,
	// served by the Positron proxy.
	test('R - Verify an htmlwidget shows in the integrated browser', { tag: [tags.ARK] }, async function ({ app, r }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('R', rReactableScript);
		await viewer.expectContentVisible(content => content.getByText('Datsun 710'));
		expect(await viewer.usesIntegratedBrowser()).toBe(true);
	});

	test('Python - Verify Open in Editor Tab opens the page in the integrated browser\'s editor', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));
		const url = await viewer.urlBar.inputValue();

		await viewer.openViewerToEditor();
		await expect(app.code.driver.currentPage.locator('.editor-instance .browser-root')).toBeVisible();
		// The editor shows the page in a browser of its own, beside the Viewer's.
		await expect.poll(() => app.code.driver.getAllWindows().filter(page => page.url() === url).length).toBe(2);
	});

	// Output a notebook renderer draws has no address, so it stays in a
	// webview, in the same Viewer as pages in the integrated browser.
	test('Python - Verify renderer output stays in a webview and Back returns to it from a page', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonGreatTablesScript);
		await viewer.expectContentVisible(content => content.getByRole('cell', { name: 'apricot' }), { useIframe: false });
		expect(await viewer.usesIntegratedBrowser()).toBe(false);

		await console.executeCode('Python', pythonServerScript);
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));
		expect(await viewer.usesIntegratedBrowser()).toBe(true);

		await viewer.navigateBack();
		await viewer.expectContentVisible(content => content.getByRole('cell', { name: 'apricot' }), { useIframe: false });
		expect(await viewer.usesIntegratedBrowser()).toBe(false);
	});

	// An app the Viewer is pointed at before it's up shows why it failed, and
	// Reload tries again.
	test('Python - Verify a page that fails to load shows an error and loads on Reload', { tag: [tags.PYTHON] }, async function ({ app, python }) {
		const { console, viewer } = app.workbench;

		await console.executeCode('Python', pythonUnservedScript);
		await viewer.expectLoadError();

		await console.executeCode('Python', pythonServeOnPortScript);
		await viewer.reloadAfterLoadError();
		await viewer.expectContentVisible(content => content.getByRole('heading', { name: 'Page One' }));
	});
});

// A single word so a double-click selects the whole token.
const COPY_PROBE = 'PositronCopyProbeToken';

// Write two small pages to a folder. The first can mark itself and links to
// the second.
const pageFilesScript = `_dir = tempfile.mkdtemp()
open(os.path.join(_dir, "index.html"), "w").write('''<title>Page One</title><h1>Page One</h1><p><span>${COPY_PROBE}</span></p><button onclick='document.body.append("Marked")'>Mark</button><a href="page2.html">Page two</a>''')
open(os.path.join(_dir, "page2.html"), "w").write("<title>Page Two</title><h1>Page Two</h1>")`;

// Serve two small pages from a local web server, as an app is, and open the
// first in the Viewer. Kept free of indented blocks so the file stays
// tab-indented for hygiene.
const pythonServerScript = `import http.server, socketserver, threading, webbrowser, tempfile, os, functools
${pageFilesScript}
_srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler, directory=_dir))
threading.Thread(target=_srv.serve_forever, daemon=True).start()
webbrowser.open(f"http://127.0.0.1:{_srv.server_address[1]}/index.html")`;

// Open a free port in the Viewer before anything serves it.
const pythonUnservedScript = `import socket, webbrowser
_s = socket.socket()
_s.bind(("127.0.0.1", 0))
_port = _s.getsockname()[1]
_s.close()
webbrowser.open(f"http://127.0.0.1:{_port}/index.html")`;

// Then serve the pages on that port.
const pythonServeOnPortScript = `import http.server, socketserver, threading, tempfile, os, functools
${pageFilesScript}
_srv = socketserver.TCPServer(("127.0.0.1", _port), functools.partial(http.server.SimpleHTTPRequestHandler, directory=_dir))
threading.Thread(target=_srv.serve_forever, daemon=True).start()`;

const pythonGreatTablesScript = `from great_tables import GT, exibble
GT(exibble)`;

const rReactableScript = `library(reactable)
mtcars |> reactable::reactable()`;
