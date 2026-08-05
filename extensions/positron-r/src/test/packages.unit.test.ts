/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Sinon from 'sinon';
import * as vscode from 'vscode';
import * as positron from 'positron';
import { RPackageManager } from '../packages';
import { RSession } from '../session';

// Button labels. vscode.l10n.t returns the source string when no bundle is
// loaded (as in tests), so these match what the manager passes to the prompt.
const INSTALL_PAK = 'Install pak';
const OPEN_SETTINGS = 'Open Settings';

/**
 * Minimal fake RSession covering only what RPackageManager touches. `execute`
 * resolves the manager's `_execute` by reporting the runtime returning to idle.
 */
class FakeRSession {
	private readonly _emitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	readonly onDidReceiveRuntimeMessage = this._emitter.event;
	readonly metadata = { sessionId: 'test-session' };

	/** Value returned for the 'pak' package (null means not installed). */
	pak: { compatible: boolean } | null = null;
	/** Whether the session reports an active renv project. */
	isRenv = false;

	/** R code passed to execute(), in order. */
	readonly executed: string[] = [];
	/** R code passed to evaluate(), in order. */
	readonly evaluated: string[] = [];
	invalidateCount = 0;

	async packageVersion(pkgName: string): Promise<{ compatible: boolean } | null> {
		return pkgName === 'pak' ? this.pak : null;
	}

	async evaluate(code: string): Promise<{ result: boolean }> {
		this.evaluated.push(code);
		return { result: this.isRenv };
	}

	execute(code: string, id: string): void {
		this.executed.push(code);
		this._emitter.fire({
			parent_id: id,
			type: positron.LanguageRuntimeMessageType.State,
			state: positron.RuntimeOnlineState.Idle,
		} as positron.LanguageRuntimeState);
	}

	invalidatePackageResourceCaches(): void {
		this.invalidateCount++;
	}
}

suite('RPackageManager pak recommendation', () => {
	let sandbox: Sinon.SinonSandbox;
	let session: FakeRSession;
	let manager: RPackageManager;
	let showInfo: Sinon.SinonStub;
	let executeCommand: Sinon.SinonStub;
	let installer: 'auto' | 'pak' | 'base';

	// The recommendation is fired fire-and-forget after the operation, so let
	// pending microtasks drain before asserting on it.
	const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

	setup(() => {
		sandbox = Sinon.createSandbox();
		session = new FakeRSession();
		manager = new RPackageManager(session as unknown as RSession);
		installer = 'auto';

		sandbox.stub(vscode.workspace, 'getConfiguration').returns({
			get: (key: string, def?: unknown) => key === 'installer' ? installer : def,
		} as unknown as vscode.WorkspaceConfiguration);
		showInfo = sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
		executeCommand = sandbox.stub(vscode.commands, 'executeCommand').resolves(undefined);
	});

	teardown(() => sandbox.restore());

	test('does not block the package operation on the notification (#14195)', async () => {
		// A blocking await on a notification that never resolves would hang the
		// operation; it must complete and only then fire the recommendation.
		showInfo.callsFake(() => new Promise<string>(() => { /* never resolves */ }));

		await manager.installPackages([{ name: 'dplyr' }]);
		await flush();

		assert.deepStrictEqual(
			{ installed: session.executed, recommended: showInfo.calledOnce },
			{ installed: ['install.packages(c("dplyr"))'], recommended: true },
		);
	});

	test('recommends pak once per session when auto and pak is absent', async () => {
		await manager.installPackages([{ name: 'dplyr' }]);
		await flush();
		await manager.updatePackages([{ name: 'dplyr' }]);
		await flush();

		assert.strictEqual(showInfo.callCount, 1);
	});

	test('does not recommend pak unless the installer is auto and pak is absent', async () => {
		// pak installs silently; base has opted out; an installed pak needs no nudge.
		const scenarios: Array<{ installer: 'auto' | 'pak' | 'base'; pak: { compatible: boolean } | null }> = [
			{ installer: 'pak', pak: null },
			{ installer: 'base', pak: null },
			{ installer: 'auto', pak: { compatible: true } },
		];

		const shown: boolean[] = [];
		for (const scenario of scenarios) {
			installer = scenario.installer;
			const sess = new FakeRSession();
			sess.pak = scenario.pak;
			const mgr = new RPackageManager(sess as unknown as RSession);
			showInfo.resetHistory();

			await mgr.installPackages([{ name: 'dplyr' }]);
			await flush();
			shown.push(showInfo.called);
		}

		assert.deepStrictEqual(shown, [false, false, false]);
	});

	test('Install pak installs pak and refreshes after the operation', async () => {
		showInfo.resolves(INSTALL_PAK);

		await manager.installPackages([{ name: 'dplyr' }]);
		await flush();

		assert.deepStrictEqual(
			{ executed: session.executed, invalidated: session.invalidateCount },
			{ executed: ['install.packages(c("dplyr"))', 'install.packages("pak")'], invalidated: 2 },
		);
	});

	test('Open Settings reveals the installer setting instead of changing it', async () => {
		showInfo.resolves(OPEN_SETTINGS);

		await manager.installPackages([{ name: 'dplyr' }]);
		await flush();

		assert.deepStrictEqual(
			executeCommand.args,
			[['workbench.action.openSettings', '@id:packages.r.installer']],
		);
	});
});

suite('RPackageManager renv detection', () => {
	let sandbox: Sinon.SinonSandbox;
	let session: FakeRSession;
	let manager: RPackageManager;

	setup(() => {
		sandbox = Sinon.createSandbox();
		session = new FakeRSession();
		manager = new RPackageManager(session as unknown as RSession);
		sandbox.stub(vscode.workspace, 'getConfiguration').returns({
			// Disable the post-install renv snapshot so `executed` holds only the
			// install command under test.
			get: (key: string, def?: unknown) => key === 'renvAutoSnapshot' ? false : def,
		} as unknown as vscode.WorkspaceConfiguration);
		sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
	});

	teardown(() => sandbox.restore());

	test('probes renv behind requireNamespace so a missing renv never errors, and caches the result', async () => {
		// renv is not installed (isRenv stays false). Two operations that consult
		// the renv state should probe R at most once -- the result is fixed for
		// the session -- and the probe must guard on requireNamespace so an
		// absent renv yields FALSE instead of "there is no package called 'renv'".
		session.isRenv = false;

		await manager.installPackages([{ name: 'dplyr' }]);
		await manager.installPackages([{ name: 'tidyr' }]);

		assert.deepStrictEqual(
			{
				probes: session.evaluated,
				installs: session.executed,
			},
			{
				probes: ['if (requireNamespace("renv", quietly = TRUE)) !is.null(renv::project()) else FALSE'],
				installs: ['install.packages(c("dplyr"))', 'install.packages(c("tidyr"))'],
			},
		);
	});

	test('routes installs through renv when the session is an renv project', async () => {
		session.isRenv = true;

		await manager.installPackages([{ name: 'dplyr' }]);

		assert.deepStrictEqual(
			session.executed,
			['renv::install(c("dplyr"), prompt = FALSE)'],
		);
	});
});

suite('RPackageManager resolveInstallVersion', () => {
	let sandbox: Sinon.SinonSandbox;
	let session: FakeRSession;
	let manager: RPackageManager;
	/** Arguments of each callMethod call, in order. */
	let calls: unknown[][];

	setup(() => {
		sandbox = Sinon.createSandbox();
		session = new FakeRSession();
		calls = [];
		manager = new RPackageManager(session as unknown as RSession);
	});

	teardown(() => {
		sandbox.restore();
	});

	/** Makes the session answer `pkg_search_versions` with the given value. */
	function answerWith(value: string[] | null): void {
		(session as unknown as { callMethod: unknown }).callMethod = async (method: string, ...args: unknown[]) => {
			calls.push([method, ...args]);
			return value;
		};
	}

	// available.packages() reports one version per package, and it is the version
	// pak would install, so it is returned as-is with nothing compared.
	test('returns the single version the configured repositories offer', async () => {
		answerWith(['1.1.4']);

		assert.strictEqual(await manager.resolveInstallVersion('dplyr'), '1.1.4');
		assert.deepStrictEqual(calls[0], ['pkg_search_versions', 'dplyr']);
	});

	test('returns undefined for a package the repositories do not have', async () => {
		answerWith([]);

		assert.strictEqual(await manager.resolveInstallVersion('nope'), undefined);
	});

	test('treats a null answer as no version', async () => {
		answerWith(null);

		assert.strictEqual(await manager.resolveInstallVersion('nope'), undefined);
	});

	// The name goes into R code elsewhere in this class, so every path that takes a
	// name has to validate it, not just the ones that existed first.
	test('rejects an invalid package name before calling the session', async () => {
		answerWith(['1.1.4']);

		await assert.rejects(() => manager.resolveInstallVersion('dplyr; system("rm -rf /")'), /Invalid R package name/);
		assert.strictEqual(calls.length, 0);
	});

	test('rejects when the token is already canceled', async () => {
		answerWith(['1.1.4']);
		const source = new vscode.CancellationTokenSource();
		source.cancel();

		await assert.rejects(() => manager.resolveInstallVersion('dplyr', source.token));
		assert.strictEqual(calls.length, 0);
	});
});
