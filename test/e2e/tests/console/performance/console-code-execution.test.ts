/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, tags } from '../../_test.setup';
import { TraceRecorder, makeSampleId, setCurrentRecorder, traceEnabled } from '../../../utils/perf-trace/recorder.js';
import { armConsoleDomTrace, drainConsoleDomTrace, domSampleToEvents } from '../../../utils/perf-trace/console-dom.js';
import { TraceName } from '../../../utils/perf-trace/schema.js';

test.use({
	suiteId: __filename
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

	// Ark emits its timing markers on the `perftrace` log target. Routing only
	// that target at trace level keeps the rest of ark quiet, so the log stays
	// small enough not to perturb what it measures. `kernel.env` is spread over
	// `RUST_LOG` in kernel-spec.ts, which is what lets a setting override it.
	const ARK_TRACE_SETTINGS: Record<string, unknown> = {
		'positron.r.kernel.env': { RUST_LOG: 'warn,ark=warn,perftrace=trace' },
		// `getArkKernelPath()` prefers a submodule build over the bundled
		// binary, so an instrumented ark built in a different checkout is only
		// picked up by pinning it here, which is also the highest-priority
		// lookup. The manifest records which binary actually launched.
		...(process.env.POSITRON_PERF_TRACE_ARK
			? { 'positron.r.kernel.path': process.env.POSITRON_PERF_TRACE_ARK }
			: {}),
	};

	test.beforeAll(async function ({ settings }) {
		await settings.set({
			'console.scrollbackSize': SCROLLBACK_SIZE,
			...(traceEnabled ? ARK_TRACE_SETTINGS : {}),
		});
	});

	test.afterAll(async function ({ settings }) {
		await settings.remove(['console.scrollbackSize', ...(traceEnabled ? Object.keys(ARK_TRACE_SETTINGS) : [])]);
	});

	// Opt-in experiment: submit one untimed R expression before the timed
	// `simple_expression` sample, so it is not the first submission into a
	// freshly started R session. Isolates first-submission cost (services
	// activation on the focus chord) from execution cost. Off by default: the
	// production spec's ordering is what the dashboard's history was recorded
	// under, and must not change except under this explicit flag.
	const warmRBeforeSimple = process.env.POSITRON_PERF_TRACE_WARM_R === '1';

	for (const { lang, runtime, target, prompt } of LANGUAGES) {
		for (const scenario of SCENARIOS) {
			const code = lang === 'Python' ? scenario.python : scenario.r;

			test(`${lang} - ${scenario.name}`,
				async function ({ app, page, sessions, metric }, testInfo) {
					const { console: positronConsole } = app.workbench;
					await sessions.start(runtime, { reuse: true });

					if (warmRBeforeSimple && lang === 'R' && scenario.variant === 'simple_expression') {
						await positronConsole.waitForReady(prompt);
						await positronConsole.pasteCodeToConsole('1 + 1', true);
						await positronConsole.waitForReady(prompt);
					}

					// Pre-timer setup: ensure console is focused and idle, then stage the code.
					// pasteCodeToConsole dispatches a ClipboardEvent directly to the input
					// element so it doesn't need keyboard focus.
					await positronConsole.waitForReady(prompt);
					await positronConsole.pasteCodeToConsole(code);
					await page.waitForTimeout(200);

					const sampleId = makeSampleId(testInfo.title, testInfo.repeatEachIndex);
					const recorder = new TraceRecorder(sampleId);
					setCurrentRecorder(recorder);

					// Arming is a CDP round trip, so it happens before the timer
					// starts. The observer it installs reports when the DOM
					// actually changed, which the polled assertions below cannot.
					if (traceEnabled) {
						await recorder.span(TraceName.harness.armStart, TraceName.harness.armEnd, () =>
							armConsoleDomTrace(page, { expectedOutput: scenario.output, prompt, sampleId }));
					}

					try {
						// Metric: Enter keypress → output appears → prompt returns.
						// waitForConsoleContents guards against Enter missing the console —
						// if focus was lost, no output appears and the test fails rather than
						// recording a false near-0ms result from an already-idle prompt.
						//
						// The helpers are called unchanged so the recorded duration stays
						// comparable to the dashboard's history; the markers inside them
						// attribute that duration without altering it.
						const { duration_ms } = await metric.console.executeCode(async () => {
							recorder.mark(TraceName.harness.sampleStart);
							await recorder.span(TraceName.harness.enterPressStart, TraceName.harness.enterPressEnd,
								() => page.keyboard.press('Enter'));
							await positronConsole.waitForConsoleContents(scenario.output, { timeout: 60000 });
							await positronConsole.waitForReady(prompt, 60000);
							recorder.mark(TraceName.harness.sampleEnd);
						}, target, {
							language: lang,
							description: `${lang}: ${scenario.name}`,
							variant: scenario.variant,
						});

						expect(duration_ms).toBeGreaterThan(0);
						if (!process.env.CI) { console.log(`[perf] execute_code ${target} (${scenario.name}): ${duration_ms} ms`); }
					} finally {
						// Drained in `finally` so a timed-out assertion still yields
						// the timeline that shows which stage never completed. A drain
						// that throws is swallowed: it would otherwise replace the
						// failure being investigated with its own.
						if (traceEnabled) {
							try {
								recorder.mark(TraceName.harness.drainStart);
								const { dom, rendererEvents } = await drainConsoleDomTrace(page);
								recorder.mark(TraceName.harness.drainEnd);
								recorder.adopt(rendererEvents);
								recorder.adopt(domSampleToEvents(dom, { sample_id: sampleId }));
							} catch (err) {
								console.log(`[perf] trace drain failed: ${err}`);
							}
							recorder.clockPair();
							recorder.flush();
						}
						setCurrentRecorder(undefined);
					}
				}
			);
		}
	}
});
