/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R repro', {
	tag: [tags.CONSOLE, tags.ARK]
}, () => {
	test('R - continuation indentation repro', async function ({ app, r }) {
		const { console } = app.workbench;
		const page = app.code.driver.currentPage;

		const dump = async (label: string) => {
			const input = page.locator('.console-instance .console-input').last();
			const margin = input.locator('.monaco-editor .margin').first();
			const viewLines = input.locator('.monaco-editor .view-lines').first();
			const lineNumbers = input.locator('.monaco-editor .margin .line-numbers');
			const marginBox = await margin.boundingBox();
			const viewBox = await viewLines.boundingBox();
			const inputBox = await input.boundingBox();
			const lnCount = await lineNumbers.count();
			const lnTexts: string[] = [];
			const lnBoxes: string[] = [];
			for (let i = 0; i < lnCount; i++) {
				lnTexts.push((await lineNumbers.nth(i).textContent() ?? '').replace(/ /g, '_').replace(/ /g, '.'));
				const b = await lineNumbers.nth(i).boundingBox();
				lnBoxes.push(b ? `${Math.round(b.x)},${Math.round(b.width)}` : 'null');
			}
			const cursor = input.locator('.monaco-editor .cursor').first();
			const cursorBox = await cursor.boundingBox();
			// eslint-disable-next-line no-console
			globalThis.console.log(`REPRO[${label}] inputX=${Math.round(inputBox?.x ?? -1)} marginX=${Math.round(marginBox?.x ?? -1)} marginW=${Math.round(marginBox?.width ?? -1)} viewX=${Math.round(viewBox?.x ?? -1)} cursorX=${Math.round(cursorBox?.x ?? -1)} lnTexts=${JSON.stringify(lnTexts)} lnBoxes=${JSON.stringify(lnBoxes)}`);
		};

		// Warm up.
		await console.typeToConsole('2+3', true);
		await console.waitForConsoleContents('[1] 5', { timeout: 15000 });
		await page.waitForTimeout(2000);

		// Continuation.
		await console.typeToConsole('2 +', true);
		await console.waitForReady('+', 10000);
		await page.waitForTimeout(500);
		await dump('after-2plus');

		expect(true).toBe(true);
	});
});
