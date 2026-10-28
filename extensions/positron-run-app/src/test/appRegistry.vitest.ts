/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AppOutput } from '../appOutput';
import { AppController, AppError, AppInfo, AppRegistry, AppStatus, ReadOutputResult, RESULT_BUDGET, RunningApp, UNTRUSTED_NOTE } from '../appRegistry';

/** Short enough to keep the suite fast, long enough not to race the fakes. */
const TIMEOUT = 50;

const streamlit: AppInfo = { file: 'file:///proj/app.py', name: 'Streamlit', runsIn: 'terminal', preview: 'viewer' };
const shiny: AppInfo = { file: 'file:///proj/app.R', name: 'Shiny', runsIn: 'console', preview: 'viewer', sessionId: 'session-1' };

/**
 * An app whose controller does what a real one would: `interrupt` stops it
 * when `stopsOn` is `'interrupt'`, and `terminate` stops it unless `stopsOn`
 * is `'never'`. Each action throws instead when it is listed in `throws`.
 */
function makeApp(info: AppInfo, options: {
	status?: Exclude<AppStatus, 'exited'>;
	stopsOn?: 'interrupt' | 'terminate' | 'never';
	canTerminate?: boolean;
	throws?: ReadonlyArray<'interrupt' | 'terminate'>;
	output?: AppOutput;
} = {}) {
	const { status = 'starting', stopsOn = 'interrupt', canTerminate = true, throws = [] } = options;
	const calls: string[] = [];
	const controller: AppController = {
		interrupt: async () => {
			calls.push('interrupt');
			if (throws.includes('interrupt')) {
				throw new Error('Terminal has already been disposed');
			}
			if (stopsOn === 'interrupt') {
				app.exited(130);
			}
		},
		terminate: canTerminate ? async () => {
			calls.push('terminate');
			if (throws.includes('terminate')) {
				throw new Error('Could not close the terminal');
			}
			if (stopsOn !== 'never') {
				app.exited();
			}
		} : undefined,
	};
	const app = new RunningApp(info, controller, status, options.output);
	const preview = { dispose: vi.fn() };
	app.setPreview(preview);
	return { app, calls, preview };
}

describe('AppRegistry', () => {
	it('lists each app with what it is and where it runs', () => {
		const registry = new AppRegistry();
		registry.add(makeApp(streamlit).app);
		registry.add(makeApp(shiny).app);

		expect(registry.list()).toMatchInlineSnapshot(`
			[
			  {
			    "exitCode": undefined,
			    "file": "file:///proj/app.py",
			    "localUrl": undefined,
			    "name": "Streamlit",
			    "preview": "viewer",
			    "runsIn": "terminal",
			    "status": "starting",
			    "url": undefined,
			  },
			  {
			    "exitCode": undefined,
			    "file": "file:///proj/app.R",
			    "localUrl": undefined,
			    "name": "Shiny",
			    "preview": "viewer",
			    "runsIn": "console",
			    "sessionId": "session-1",
			    "status": "starting",
			    "url": undefined,
			  },
			]
		`);
	});

	it('updates an app as it starts, serves, and exits', () => {
		const { app: terminalApp } = makeApp(streamlit);
		const { app: consoleApp } = makeApp(shiny);
		const state = (app: RunningApp) => {
			const { status, url, localUrl, exitCode } = app.toSummary();
			return { status, url, localUrl, exitCode };
		};
		const seen = [state(terminalApp)];

		terminalApp.foundUrl('http://localhost:8501/', 'https://workbench.example/s/abc/p/1234/');
		seen.push(state(terminalApp));
		terminalApp.exited(1);
		seen.push(state(terminalApp));

		// Positron gave up looking for its URL, but the app is still running.
		consoleApp.stoppedWatchingForUrl();
		seen.push(state(consoleApp));

		const urls = { url: 'https://workbench.example/s/abc/p/1234/', localUrl: 'http://localhost:8501/' };
		expect(seen).toEqual([
			{ status: 'starting' },
			{ status: 'running', ...urls },
			{ status: 'exited', ...urls, exitCode: 1 },
			{ status: 'running' },
		]);
	});

	it('replaces an app with the next one run under the same name', () => {
		// Positron closes an app's terminal before running another app of the
		// same framework, so only the newer one is still around.
		const registry = new AppRegistry();
		const { app: first } = makeApp(streamlit);
		const { app: second } = makeApp({ ...streamlit, file: 'file:///proj/other.py' });
		registry.add(first);
		registry.add(second);

		// The replaced app exiting must not touch the one that replaced it.
		first.exited(0);

		expect(registry.list().map(({ file, status }) => ({ file, status }))).toEqual([
			{ file: 'file:///proj/other.py', status: 'starting' },
		]);
	});

	it('keeps the exit code when its terminal closes after it exited', () => {
		// A terminal app's execution ends with an exit code; closing its terminal
		// later reports the exit again, without one.
		const { app } = makeApp(streamlit);
		app.exited(0);
		app.exited();
		app.stoppedWatchingForUrl();

		expect({ status: app.status, exitCode: app.toSummary().exitCode }).toEqual({ status: 'exited', exitCode: 0 });
	});
});

describe('stopping an app', () => {
	it('interrupts it, and closes its preview once it has stopped', async () => {
		const registry = new AppRegistry();
		const { app, calls, preview } = makeApp(streamlit);
		registry.add(app);

		const result = await registry.stop(streamlit.file, TIMEOUT);

		expect({ result, calls, status: app.status, previewClosed: preview.dispose.mock.calls.length }).toEqual({
			result: { stopped: true, file: streamlit.file, name: 'Streamlit', method: 'interrupted' },
			calls: ['interrupt'],
			status: 'exited',
			previewClosed: 1,
		});
	});

	it('terminates it when an interrupt does not stop it', async () => {
		const { app, calls, preview } = makeApp(streamlit, { stopsOn: 'terminate' });

		const result = await app.stop(TIMEOUT);

		expect({ method: result.stopped && result.method, calls, previewClosed: preview.dispose.mock.calls.length }).toEqual({
			method: 'terminated',
			calls: ['interrupt', 'terminate'],
			previewClosed: 1,
		});
	});

	it('terminates it straight away when Positron cannot see its process', async () => {
		// Without shell integration Positron never learns whether an interrupt
		// worked, so waiting on one would only delay the stop.
		const { app, calls } = makeApp(streamlit, { status: 'unknown', stopsOn: 'terminate' });

		const result = await app.stop(TIMEOUT);

		expect({ method: result.stopped && result.method, calls }).toEqual({ method: 'terminated', calls: ['terminate'] });
	});

	it('terminates it when the interrupt fails', async () => {
		// Sending Ctrl+C throws when the terminal has just been disposed.
		const { app, calls } = makeApp(streamlit, { stopsOn: 'terminate', throws: ['interrupt'] });

		const result = await app.stop(TIMEOUT);

		expect({ method: result.stopped && result.method, calls }).toEqual({ method: 'terminated', calls: ['interrupt', 'terminate'] });
	});

	it('reports why it could not stop an app, rather than rejecting', async () => {
		const { app } = makeApp(streamlit, { throws: ['interrupt', 'terminate'] });

		expect(await app.stop(TIMEOUT)).toEqual({
			stopped: false,
			reason: 'did-not-stop',
			message: 'Positron could not stop the Streamlit app: Terminal has already been disposed; Could not close the terminal',
		});
	});

	it('reports an app that is still running and leaves its preview open', async () => {
		// A console app has no forcible way to stop.
		const { app, calls, preview } = makeApp(shiny, { stopsOn: 'never', canTerminate: false });

		const result = await app.stop(TIMEOUT);

		expect({ result, calls, status: app.status, previewClosed: preview.dispose.mock.calls.length }).toEqual({
			result: {
				stopped: false,
				reason: 'did-not-stop',
				message: 'The Shiny app was still running 0.05 seconds after it was asked to stop.',
			},
			calls: ['interrupt'],
			status: 'starting',
			previewClosed: 0,
		});
	});

	it('reports an app that has already exited, without touching it', async () => {
		const { app, calls } = makeApp(streamlit);
		app.exited(1);

		const result = await app.stop(TIMEOUT);

		expect({ result, calls }).toEqual({
			result: { stopped: false, reason: 'not-running', message: 'The Streamlit app has already exited.' },
			calls: [],
		});
	});

	it('reports a file Positron has not run an app from', async () => {
		const registry = new AppRegistry();
		registry.add(makeApp(streamlit).app);

		expect(await registry.stop('file:///proj/unknown.py', TIMEOUT)).toEqual({
			stopped: false,
			reason: 'not-found',
			message: 'Positron isn\'t tracking an app from file:///proj/unknown.py. Running another app of the same framework replaces the one before it.',
		});
	});

	it('stops the newest still-running app when one file ran under several names', async () => {
		// Re-running Streamlit makes it newer than Flask, even though Streamlit
		// was the first name used; the newest run, Gradio, has already exited.
		const registry = new AppRegistry();
		registry.add(makeApp(streamlit).app);
		registry.add(makeApp({ ...streamlit, name: 'Flask' }).app);
		registry.add(makeApp(streamlit).app);
		const { app: gradio } = makeApp({ ...streamlit, name: 'Gradio' });
		registry.add(gradio);
		gradio.exited(1);

		const result = await registry.stop(streamlit.file, TIMEOUT);

		expect({ stopped: result.stopped && result.name, listed: registry.list().map(app => app.name) })
			.toEqual({ stopped: 'Streamlit', listed: ['Flask', 'Streamlit', 'Gradio'] });
	});
});

describe('reading an app\'s output', () => {
	/** An app whose output is `printed`. */
	function appWithOutput(info: AppInfo, printed = '', options: Parameters<typeof makeApp>[1] = {}) {
		const output = new AppOutput();
		output.append(printed);
		return makeApp(info, { ...options, output }).app;
	}

	/** The fields of a successful read, failing the test on any other. */
	function readOk(result: ReadOutputResult) {
		if (!result.read) {
			expect.fail(`expected a read, got ${result.reason}: ${result.message}`);
		}
		return result;
	}

	const keyError: AppError = {
		name: 'KeyError',
		message: '\x1b[31m\'API_KEY\'\x1b[0m',
		traceback: ['\x1b[1mTraceback (most recent call last):\x1b[0m', '  File "app.py", line 3'],
	};

	it('returns the app\'s recent output, its state, and that the output is untrusted', () => {
		const registry = new AppRegistry();
		const app = appWithOutput(streamlit, 'Starting\nKeyError: \'API_KEY\'\n');
		registry.add(app);
		app.exited(1);

		expect(registry.read(streamlit.file, {})).toEqual({
			read: true,
			file: streamlit.file,
			name: 'Streamlit',
			status: 'exited',
			exitCode: 1,
			output: 'Starting\nKeyError: \'API_KEY\'',
			firstLine: 1,
			lastLine: 2,
			totalLines: 2,
			droppedLines: 0,
			moreBefore: false,
			note: UNTRUSTED_NOTE,
		});
	});

	it('reads the app stopping would stop', () => {
		// The same lookup as stopping: the newest still-running app from the file.
		const registry = new AppRegistry();
		registry.add(appWithOutput(streamlit, 'streamlit\n'));
		registry.add(appWithOutput({ ...streamlit, name: 'Flask' }, 'flask\n'));
		const gradio = appWithOutput({ ...streamlit, name: 'Gradio' }, 'gradio\n');
		registry.add(gradio);
		gradio.exited(1);

		expect(readOk(registry.read(streamlit.file, {})).output).toBe('flask');
	});

	it('reports a file Positron is not tracking an app from', () => {
		const registry = new AppRegistry();
		registry.add(appWithOutput(streamlit));

		expect(registry.read('file:///proj/unknown.py', {})).toEqual({
			read: false,
			reason: 'not-found',
			message: 'Positron isn\'t tracking an app from file:///proj/unknown.py. Running another app of the same framework replaces the one before it.',
		});
	});

	it('says why there is no output for an app run without shell integration, even after its terminal closes', () => {
		const { app } = makeApp(streamlit, { status: 'unknown' });
		const before = app.read({});
		app.exited();

		expect([before, app.read({})]).toEqual(Array(2).fill({
			read: false,
			reason: 'no-output',
			message: 'Shell integration was off when the Streamlit app ran, so Positron could not see its output.',
		}));
	});

	it('gives the error that ended a console app, stripped of escapes, outside the lines', () => {
		const app = appWithOutput(shiny, 'one\ntwo\n');
		app.failed(keyError);

		const result = readOk(app.read({ lines: 1 }));

		expect({ output: result.output, error: result.error }).toEqual({
			output: 'two',
			error: { name: 'KeyError', message: '\'API_KEY\'', traceback: ['Traceback (most recent call last):', '  File "app.py", line 3'] },
		});
	});

	it('records an interrupt like any other error, and keeps the latest', () => {
		const app = appWithOutput(shiny);
		app.failed(keyError);
		app.failed({ name: 'Interrupted', message: 'The user interrupted the code execution.', traceback: [] });

		expect(readOk(app.read({})).error).toEqual({ name: 'Interrupted', message: 'The user interrupted the code execution.', traceback: [] });
	});

	it('cuts a long error message and long frames, and keeps the start and end of a long traceback', () => {
		const app = appWithOutput(shiny);
		app.failed({
			name: 'Error',
			message: 'm'.repeat(5_000),
			traceback: ['f'.repeat(5_000), ...Array.from({ length: 199 }, (_, i) => `frame ${i + 2}`)],
		});

		const { traceback, message } = readOk(app.read({})).error!;

		expect({
			message,
			frames: traceback.length,
			first: traceback[0],
			around: traceback.slice(9, 12),
			last: traceback.at(-1),
		}).toEqual({
			message: 'm'.repeat(1_000) + ' [truncated]',
			frames: 51,
			first: 'f'.repeat(1_000) + ' [truncated]',
			around: ['frame 10', '[150 frames left out]', 'frame 161'],
			last: 'frame 200',
		});
	});

	it('stays within the budget with a large error and long lines', () => {
		const output = new AppOutput();
		for (let i = 0; i < 2_000; i++) {
			output.append('"' + 'x'.repeat(2_000) + '"\n');
		}
		const { app } = makeApp(shiny, { output });
		app.failed({
			name: 'Error',
			message: '"'.repeat(5_000),
			traceback: Array.from({ length: 200 }, () => '\\'.repeat(5_000)),
		});

		const result = readOk(app.read({ lines: 1000 }));

		expect({
			size: JSON.stringify(result).length <= RESULT_BUDGET,
			errorSize: JSON.stringify(result.error).length <= RESULT_BUDGET / 2,
			hasOutput: result.lastLine === 2_000 && result.firstLine < result.lastLine,
			note: result.note,
		}).toEqual({ size: true, errorSize: true, hasOutput: true, note: UNTRUSTED_NOTE });
	});
});
