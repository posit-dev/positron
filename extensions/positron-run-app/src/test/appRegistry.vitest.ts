/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { AppController, AppInfo, AppRegistry, AppStatus, RunningApp } from '../appRegistry';

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
	const app = new RunningApp(info, controller, status);
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

	it('keeps an exited app at the status it exited with', () => {
		const { app } = makeApp(streamlit);
		app.exited(0);
		app.exited(1);
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
			message: 'Positron has no record of running an app from file:///proj/unknown.py.',
		});
	});

	it('stops the running app when the same file ran under two names', async () => {
		const registry = new AppRegistry();
		const { app: running } = makeApp({ ...streamlit, name: 'Flask' });
		const { app: exited } = makeApp(streamlit);
		registry.add(running);
		registry.add(exited);
		exited.exited(0);

		const result = await registry.stop(streamlit.file, TIMEOUT);

		expect(result.stopped && result.name).toBe('Flask');
	});

	it('stops the newest run when the same file is running under two names', async () => {
		// Running the Streamlit app again makes it the newest, even though
		// Streamlit was the first name used.
		const registry = new AppRegistry();
		registry.add(makeApp(streamlit).app);
		registry.add(makeApp({ ...streamlit, name: 'Flask' }).app);
		registry.add(makeApp(streamlit).app);

		const result = await registry.stop(streamlit.file, TIMEOUT);

		expect({ stopped: result.stopped && result.name, listed: registry.list().map(app => app.name) })
			.toEqual({ stopped: 'Streamlit', listed: ['Flask', 'Streamlit'] });
	});
});
