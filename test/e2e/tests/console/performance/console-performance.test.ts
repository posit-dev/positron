/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename
});

const LANGUAGES = [
	{ lang: 'Python', runtime: 'python', target: 'console.python', prompt: '>>>' },
	{ lang: 'R', runtime: 'r', target: 'console.r', prompt: '>' },
] as const;

const SCENARIOS = [
	{
		name: 'simple expression',
		python: '2 ** 32',
		r: '2 ^ 32',
	},
	{
		// Output-heavy: stress the console output rendering pipeline.
		// Regression target: posit-dev/positron#9852 (console lag after large output)
		name: 'large output',
		python: "print('\\n'.join(str(i) for i in range(1000)))",
		r: "cat(paste(seq_len(1000), collapse = '\\n'), '\\n')",
	},
] as const;

test.describe('Console Performance: Code Execution', {
	tag: [tags.CONSOLE, tags.PERFORMANCE, tags.WIN, tags.WEB]
}, () => {

	for (const { lang, runtime, target, prompt } of LANGUAGES) {
		const extraTag = runtime === 'r' ? [tags.ARK] : [];

		for (const scenario of SCENARIOS) {
			const code = lang === 'Python' ? scenario.python : scenario.r;

			test(`${lang} - ${scenario.name}`,
				{ tag: extraTag },
				async function ({ app, page, sessions, metric }) {
					await sessions.start(runtime, { reuse: true });

					// Pre-timer setup: ensure console is focused and idle, then stage the code.
					// pasteCodeToConsole dispatches a ClipboardEvent directly to the input
					// element so it doesn't need keyboard focus.
					await app.workbench.console.waitForReady(prompt);
					await app.workbench.console.pasteCodeToConsole(code);

					// Metric captures only: Enter keypress → prompt returns.
					// Avoids the 500ms artificial waitForTimeout inside sendEnterKey().
					const { duration_ms } = await metric.console.executeCode(async () => {
						await page.keyboard.press('Enter');
						await app.workbench.console.waitForReady(prompt, 60000);
					}, target, {
						language: lang,
						description: `${lang}: ${scenario.name}`,
					});

					expect(duration_ms).toBeGreaterThan(0);
					if (!process.env.CI) { console.log(`[perf] execute_code ${target} (${scenario.name}): ${duration_ms} ms`); }
				}
			);
		}
	}
});
