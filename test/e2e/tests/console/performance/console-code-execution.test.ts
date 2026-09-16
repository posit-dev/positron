/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../../_test.setup';

test.use({
	suiteId: __filename,
	// Disable snapshots because document-wide capture includes a previous session's
	// console at `z-index: -1` and attributes its output to this sample.
	snapshots: false
});

const LANGUAGES = [
	{ lang: 'Python', runtime: 'python', target: 'console.python', prompt: '>>>' },
	{ lang: 'R', runtime: 'r', target: 'console.r', prompt: '>' },
] as const;

// `variant` is the stable grouping key; `name` is the display label. Keep them
// decoupled. See utils/metrics/README.md for choosing dimensions.
const SCENARIOS = [
	{
		name: 'simple expression',
		variant: 'simple_expression',
		python: '2 ** 32',
		r: '2 ^ 32',
		// Both expressions evaluate to 4294967296
		output: '4294967296',
	},
	{
		// Scrollback-cap scenario: 3000 lines exceeds the 2000-line cap pinned in beforeAll,
		// which forces scrollback trimming on every append batch. This directly exercises the
		// path posit-dev/positron#13201 fixed and guards against re-render-on-append regressions
		// (posit-dev/positron#9852). Running below the default 10,000-line cap would never
		// trigger trimming and would leave the regression undetected.
		name: 'scrollback trim',
		variant: 'scrollback_trim',
		python: 'print("\\n".join(str(i) for i in range(1, 3001)))',
		r: 'cat(paste(seq_len(3000), collapse = "\\n"), "\\n")',
		// '2999' appears in both outputs but not in either code string
		output: '2999',
	},
] as const;

test.describe('Console Performance: Code Execution', {
	tag: [tags.CONSOLE, tags.PERFORMANCE, tags.WIN, tags.WEB]
}, () => {

	// Pin scrollbackSize so the large-output scenario reliably exceeds the cap and exercises
	// scrollback trimming. Without this, the default 10,000-line cap would never be reached
	// in any scenario here, and trimming-path regressions would go undetected.
	const SCROLLBACK_SIZE = 2000;

	test.beforeAll(async function ({ settings }) {
		await settings.set({ 'console.scrollbackSize': SCROLLBACK_SIZE });
	});

	test.afterAll(async function ({ settings }) {
		await settings.remove(['console.scrollbackSize']);
	});

	for (const { lang, runtime, target, prompt } of LANGUAGES) {
		for (const scenario of SCENARIOS) {
			const code = lang === 'Python' ? scenario.python : scenario.r;

			test(`${lang} - ${scenario.name}`,
				async function ({ app, page, sessions, metric }) {
					const { console: positronConsole } = app.workbench;
					await sessions.start(runtime, { reuse: true });

					// Pre-timer setup: Clear output so the wait can match only this
					// submission. `waitForReady()` establishes focus outside the timer,
					// and `pasteCodeToConsole()` preserves it.
					await positronConsole.clearButton.click();
					await positronConsole.waitForReady(prompt);
					await positronConsole.pasteCodeToConsole(code);
					await page.waitForTimeout(200);

					// Metric: Enter keypress → output appears → prompt returns.
					// Keep focus restoration outside the measurement. `waitForReady()`
					// sends `Cmd+K F` and those keypresses slow as the console DOM grows.
					// `waitForConsoleContents()` fails if Enter misses the console,
					// preventing an idle prompt from producing a near-zero duration.
					const { duration_ms } = await metric.console.executeCode(async () => {
						await page.keyboard.press('Enter');
						await positronConsole.waitForConsoleContents(scenario.output, { timeout: 60000 });
						await positronConsole.expectPromptReady(prompt, 60000);
					}, target, {
						language: lang,
						description: `${lang}: ${scenario.name}`,
						variant: scenario.variant,
					});

					expect(duration_ms).toBeGreaterThan(0);
					if (!process.env.CI) { console.log(`[perf] execute_code ${target} (${scenario.name}): ${duration_ms} ms`); }
				}
			);
		}
	}
});
