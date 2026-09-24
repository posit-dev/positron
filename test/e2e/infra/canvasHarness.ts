/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect } from '@playwright/test';
import { Code, launch } from './code';
import { Quality } from './application';
import { FileLogger, Logger, MultiLogger } from './logger';
import { Workbench } from './workbench';
import { getDevElectronPath, getBuildElectronPath } from './electron';
import { listNativeWindows, NativeWindow, readWindowTimeline, requestQuit, startWindowTimeline } from './electronMain';
import { formatTimeline, visibleIntervals, visibleOverlaps, VisibleOverlap, WindowSample } from './windowTimeline';
import { StorageFile } from '../pages/utils/storageFile';
import { Canvas } from '../pages/canvas';

// A Positron launch profile for Canvas end-to-end runs: its own user data,
// extensions, and shared-data dirs, temp folders to switch between, the
// assistant under test, and helpers for the parts of a Canvas smoke that live
// outside any one renderer (native windows, dialogs, quit and relaunch).

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ASSISTANT_ID = 'posit.assistant';

/**
 * Chromium throttles timers and rendering in windows it considers hidden,
 * occluded, or in the background. Canvas hides the IDE window by design, and
 * unattended runs may happen on a locked or sleeping display.
 */
const NO_BACKGROUND_THROTTLING = [
	'--disable-renderer-backgrounding',
	'--disable-background-timer-throttling',
	'--disable-backgrounding-occluded-windows',
];

/** Settings every Canvas profile gets, over the e2e defaults (fixtures/settings.json). */
const CANVAS_SETTINGS: Record<string, unknown> = {
	// Canvas is an experimental assistant feature.
	'assistant.experimentalFeatures': true,
	// The gallery must not replace the assistant under test with a release.
	'extensions.autoUpdate': false,
	'extensions.autoCheckUpdates': false,
};

/** Where the assistant under test comes from. */
export type AssistantSource =
	/** `--extensionDevelopmentPath`: no hot-exit backups, "[Extension Development Host]" titles. */
	| { readonly kind: 'dev'; readonly path: string }
	/** A VSIX installed into the profile's extensions dir before the first launch. */
	| { readonly kind: 'vsix'; readonly path: string };

export interface CanvasHarnessOptions {
	readonly assistant: AssistantSource;
	/** Screenshots, videos, traces, logs, the window timeline. */
	readonly artifactsDir: string;
	/** Profile and fixture folders; a new temp dir by default. Keep it short (IPC socket path limit). */
	readonly root?: string;
	/** Fixture folder names, created under `<root>/f`. */
	readonly folders?: readonly string[];
	/** Symlinks to create: alias name -> target folder name. */
	readonly aliases?: Readonly<Record<string, string>>;
	/** Seed the recently opened list with these folders, most recent first. Defaults to all folders. */
	readonly recents?: readonly string[];
	/** Launch with workspace trust on (the e2e default is off). */
	readonly workspaceTrust?: boolean;
	/** Folders (names or paths) to seed as trusted. */
	readonly trusted?: readonly string[];
	readonly settings?: Readonly<Record<string, unknown>>;
	/** Record a video per window (default true). */
	readonly video?: boolean;
	/** Record a Playwright trace per launch (default true). */
	readonly trace?: boolean;
	/** Extra launch arguments for every launch. */
	readonly extraArgs?: readonly string[];
	/** Also log to this logger (e.g. the e2e runner's). */
	readonly logger?: Logger;
}

export interface LaunchCanvasOptions {
	/** Folder name or absolute path to open; null opens nothing, so the last session is restored. */
	readonly folder?: string | null;
	/** Pass `--canvas` (boot this launch into Canvas). */
	readonly canvas?: boolean;
	readonly extraArgs?: readonly string[];
}

export type SwitchRoute = 'picker' | 'dialog' | 'command';

export type SwitchOutcome =
	| { readonly switched: true; readonly ms: number }
	| { readonly switched: false; readonly refusal: string; readonly ms: number };

export class CanvasHarness {

	readonly root: string;
	/** Folder name -> absolute path, aliases included. */
	readonly folders: Readonly<Record<string, string>>;
	readonly userDataDir: string;
	readonly extensionsDir: string;
	readonly sharedDataDir: string;
	readonly logger: Logger;

	private _code: Code | undefined;
	private _workbench: Workbench | undefined;
	private _canvas: Canvas | undefined;
	private launchCount = 0;
	private shotCount = 0;
	private launchDir = '';
	/** Rendered timelines of launches that already ended (window ids restart per process). */
	private pastTimelines: string[] = [];

	private constructor(private readonly options: CanvasHarnessOptions) {
		this.root = options.root ?? fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'pcv-'));
		fs.mkdirSync(this.root, { recursive: true });
		const folderRoot = path.join(this.root, 'f');
		const folders: Record<string, string> = {};
		for (const name of options.folders ?? ['A', 'B', 'C']) {
			folders[name] = path.join(folderRoot, name);
			fs.mkdirSync(folders[name], { recursive: true });
		}
		for (const [alias, target] of Object.entries(options.aliases ?? {})) {
			folders[alias] = path.join(folderRoot, alias);
			if (!fs.existsSync(folders[alias])) {
				fs.symlinkSync(folders[target], folders[alias]);
			}
		}
		this.folders = folders;
		this.userDataDir = path.join(this.root, 'p');
		this.extensionsDir = path.join(this.root, 'x');
		this.sharedDataDir = path.join(this.root, 's');
		fs.mkdirSync(options.artifactsDir, { recursive: true });
		const fileLogger = new FileLogger(path.join(options.artifactsDir, 'harness.log'));
		this.logger = options.logger ? new MultiLogger([fileLogger, options.logger]) : fileLogger;
	}

	/** Creates the profile: settings, recents, trust, and the assistant. Nothing is launched. */
	static async create(options: CanvasHarnessOptions): Promise<CanvasHarness> {
		const harness = new CanvasHarness(options);
		await harness.prepareProfile();
		return harness;
	}

	/** The running app. Throws when nothing is running. */
	get code(): Code {
		return this.live()._code!;
	}

	/** IDE page objects, bound to the IDE (main) window. */
	get workbench(): Workbench {
		return this.live()._workbench!;
	}

	get canvas(): Canvas {
		return this.live()._canvas!;
	}

	private live(): this {
		if (!this._code) {
			throw new Error('Canvas harness: the app is not running');
		}
		return this;
	}

	get running(): boolean {
		return !!this._code;
	}

	/** Resolves a folder name to its path; absolute paths pass through. */
	folder(nameOrPath: string): string {
		return path.isAbsolute(nameOrPath) ? nameOrPath : this.folders[nameOrPath] ?? (() => { throw new Error(`Unknown fixture folder '${nameOrPath}'`); })();
	}

	private async prepareProfile(): Promise<void> {
		const userDir = path.join(this.userDataDir, 'User');
		fs.mkdirSync(userDir, { recursive: true });
		const settingsPath = path.join(userDir, 'settings.json');
		if (!fs.existsSync(settingsPath)) {
			const defaults = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test', 'e2e', 'fixtures', 'settings.json'), 'utf8'));
			fs.writeFileSync(settingsPath, JSON.stringify({ ...defaults, ...CANVAS_SETTINGS, ...this.options.settings }, null, '\t'));
			fs.copyFileSync(path.join(REPO_ROOT, 'test', 'e2e', 'fixtures', 'keybindings.json'), path.join(userDir, 'keybindings.json'));
		}

		// Recents and trust live in the application *shared* storage, which is
		// outside --user-data-dir unless --shared-data-dir moves it.
		const recents = (this.options.recents ?? (this.options.folders ?? ['A', 'B', 'C']))
			.map(name => ({ folderUri: fileUri(this.folder(name)) }));
		await StorageFile.shared(this.sharedDataDir).set('history.recentlyOpenedPathsList', JSON.stringify({ entries: recents }));
		if (this.options.trusted?.length) {
			await this.trust(...this.options.trusted);
		}

		if (this.options.assistant.kind === 'vsix') {
			await this.installVsix(this.options.assistant.path);
		}
	}

	/** Adds folders to the trusted list. Only while the app is not running: it caches trust. */
	async trust(...folders: string[]): Promise<void> {
		if (this._code) {
			throw new Error('Canvas harness: seed trust while the app is stopped');
		}
		const storage = StorageFile.shared(this.sharedDataDir);
		const existing = (await storage.getAll()).get('content.trust.model.key');
		const info: { uriTrustInfo: { uri: unknown; trusted: boolean }[] } = existing ? JSON.parse(existing) : { uriTrustInfo: [] };
		for (const folder of folders) {
			info.uriTrustInfo.push({ uri: { scheme: 'file', authority: '', path: this.folder(folder) }, trusted: true });
		}
		await storage.set('content.trust.model.key', JSON.stringify(info));
	}

	/**
	 * Installs the VSIX the way `code --install-extension` does, into this
	 * profile only. A built-in assistant of the same or a newer version would
	 * shadow it (built-ins win ties), so that is refused up front.
	 */
	private async installVsix(vsixPath: string): Promise<void> {
		const version = vsixVersion(vsixPath);
		const builtin = builtinAssistantVersion();
		if (builtin && compareVersions(builtin.version, version) >= 0) {
			throw new Error(`The built-in ${ASSISTANT_ID} ${builtin.version} at ${builtin.path} would shadow the VSIX (${version}); remove it or bump the VSIX version.`);
		}
		const build = process.env.BUILD;
		const electronPath = build ? getBuildElectronPath(build) : getDevElectronPath();
		const cli = build ? path.join(build, 'Contents', 'Resources', 'app', 'out', 'cli.js') : path.join(REPO_ROOT, 'out', 'cli.js');
		const args = [cli, ...(build ? [] : [REPO_ROOT]), ...this.profileArgs(), '--install-extension', vsixPath, '--force'];
		this.logger.log(`Installing ${vsixPath}: ${electronPath} ${args.join(' ')}`);
		const result = cp.spawnSync(electronPath, args, {
			cwd: REPO_ROOT,
			env: { ...process.env, ...devEnv(), ELECTRON_RUN_AS_NODE: '1' },
			encoding: 'utf8',
			timeout: 180_000,
		});
		this.logger.log(`--install-extension exited ${result.status}: ${result.stdout}\n${result.stderr}`);
		const installed = installedExtensions(this.extensionsDir).find(e => e.id === ASSISTANT_ID);
		if (result.status !== 0 || installed?.version !== version) {
			throw new Error(`Installing ${vsixPath} failed (exit ${result.status}, installed ${installed?.version ?? 'nothing'}):\n${result.stderr || result.stdout}`);
		}
	}

	private profileArgs(): string[] {
		return [
			`--user-data-dir=${this.userDataDir}`,
			`--extensions-dir=${this.extensionsDir}`,
			`--shared-data-dir=${this.sharedDataDir}`,
		];
	}

	// --- Lifecycle ---

	/**
	 * Launches Positron on this profile and waits for the IDE window's
	 * workbench. Canvas may still be starting; wait on `canvas.expectReady`.
	 */
	async launch(options: LaunchCanvasOptions = {}): Promise<void> {
		if (this._code) {
			throw new Error('Canvas harness: already running');
		}
		const n = ++this.launchCount;
		this.launchDir = path.join(this.options.artifactsDir, `launch-${n}`);
		const folder = options.folder === null ? undefined : this.folder(options.folder ?? Object.keys(this.folders)[0]);
		const packageVersion = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version as string;
		const [major, minor, patch] = packageVersion.split('.').map(part => parseInt(part, 10));
		const dev = this.options.assistant.kind === 'dev';
		this.logger.log(`Launch ${n}: folder=${folder ?? '(restore)'} canvas=${!!options.canvas}`);

		const code = await launch({
			codePath: process.env.BUILD,
			workspacePath: folder,
			userDataDir: this.userDataDir,
			extensionsPath: this.extensionsDir,
			logger: this.logger,
			logsPath: path.join(this.launchDir, 'logs'),
			crashesPath: path.join(this.launchDir, 'crashes'),
			verbose: !!process.env.VERBOSE,
			quality: Quality.Dev,
			version: { major, minor, patch },
			extensionDevelopmentPath: dev ? this.options.assistant.path : undefined,
			enableWorkspaceTrust: this.options.workspaceTrust,
			tracing: this.options.trace ?? true,
			customTracing: true,
			snapshots: true,
			...(this.options.video ?? true ? { recordVideo: { dir: path.join(this.launchDir, 'videos'), size: { width: 1280, height: 800 } } } : {}),
			extraArgs: [
				`--shared-data-dir=${this.sharedDataDir}`,
				...NO_BACKGROUND_THROTTLING,
				...(options.canvas ? ['--canvas'] : []),
				...(this.options.extraArgs ?? []),
				...(options.extraArgs ?? []),
			],
			// An IDE terminal exports these and they break an Electron launch.
			extraEnv: { ...devEnv(), ELECTRON_RUN_AS_NODE: undefined, ELECTRON_NO_ATTACH_CONSOLE: undefined },
		});
		this._code = code;
		this._workbench = new Workbench(code);
		this._canvas = new Canvas(code);
		try {
			await startWindowTimeline(code.electronApp!);
			await this.waitForIdeWindow();
		} catch (error) {
			await this.shot('launch-failed').catch(() => undefined);
			throw error;
		}
	}

	/** Waits until the IDE window's (new) document has a restored workbench. */
	async waitForIdeWindow(timeout = 90_000): Promise<void> {
		const page = this.code.driver.currentPage;
		await page.waitForFunction(() => !!(window as unknown as { driver?: unknown }).driver, undefined, { timeout, polling: 100 });
		await this.code.whenWorkbenchRestored();
		await this.canvas.waitForCommands(timeout);
	}

	/**
	 * Quits the way the Quit menu item does (hot exit, state saves, runtime
	 * shutdown) and waits for the process to exit. A quit that hangs is killed
	 * and reported as an error.
	 */
	async quit(timeout = 60_000): Promise<void> {
		const code = this.code;
		await this.endLaunch();
		const exited = processExit(code);
		await requestQuit(code.electronApp!).catch(error => this.logger.log(`quit request: ${error}`));
		const clean = await Promise.race([exited.then(() => true), delay(timeout).then(() => false)]);
		await this.closeCode(code);
		if (!clean) {
			throw new Error(`Positron did not exit within ${timeout}ms of a quit request; it was killed`);
		}
	}

	/** SIGKILLs the app's process tree, as a crash or force quit would. */
	async kill(): Promise<void> {
		const code = this.code;
		await this.endLaunch();
		await this.closeCode(code);
	}

	/** Stops whatever is running (kills it) and writes the timeline. Keeps the profile. */
	async dispose(): Promise<void> {
		if (this._code) {
			await this.kill().catch(error => this.logger.log(`dispose: ${error}`));
		}
		fs.writeFileSync(path.join(this.options.artifactsDir, 'window-timeline.txt'), this.pastTimelines.join('\n\n'));
	}

	/** Removes the profile and fixture folders. */
	removeProfile(): void {
		fs.rmSync(this.root, { recursive: true, force: true, maxRetries: 3 });
	}

	/** Saves the trace and the timeline of the running launch before it ends. */
	private async endLaunch(): Promise<void> {
		const code = this.code;
		if (this.options.trace ?? true) {
			await code.stopTracing(`launch-${this.launchCount}`, true, path.join(this.launchDir, 'trace.zip')).catch(() => undefined);
		}
		const samples = await readWindowTimeline(code.electronApp!).catch(() => [] as WindowSample[]);
		const rendered = formatTimeline(samples);
		this.pastTimelines.push(`== launch-${this.launchCount} (${new Date(samples[0]?.t ?? Date.now()).toISOString()})\n${rendered}`);
		fs.writeFileSync(path.join(this.launchDir, 'window-timeline.txt'), rendered);
	}

	/** Kills what is left of the process tree and releases Playwright's handles (finalizes videos). */
	private async closeCode(code: Code): Promise<void> {
		this._code = this._workbench = this._canvas = undefined;
		await code.exit();
	}

	// --- Native windows ---

	/** Every native window, with visibility. */
	async windows(): Promise<NativeWindow[]> {
		return listNativeWindows(this.code.electronApp!);
	}

	/** The IDE (main) window: the one showing the workbench document. */
	async ideWindow(): Promise<NativeWindow> {
		const main = (await this.windows()).find(w => /\/workbench\/workbench(-dev)?\.html/.test(w.url));
		if (!main) {
			throw new Error('No native window shows the workbench document');
		}
		return main;
	}

	/** Window samples of the running launch, oldest first. */
	async timeline(): Promise<WindowSample[]> {
		return readWindowTimeline(this.code.electronApp!);
	}

	/** Spans since `since` (epoch ms) with two or more windows on screen. */
	async overlapsSince(since: number): Promise<VisibleOverlap[]> {
		const samples = await this.timeline();
		// Carry each window's state at `since` into the slice.
		const before = new Map<number, WindowSample>();
		for (const sample of samples.filter(s => s.t < since)) {
			before.set(sample.id, sample);
		}
		const slice = [...[...before.values()].map(s => ({ ...s, t: since })), ...samples.filter(s => s.t >= since)];
		return visibleOverlaps(slice);
	}

	/** Titles of windows that were on screen at any point since `since`. */
	async shownSince(since: number): Promise<{ id: number; title: string; start: number; end: number | undefined }[]> {
		return visibleIntervals(await this.timeline()).filter(i => (i.end ?? Infinity) > since);
	}

	/**
	 * Waits until Canvas is settled on `folder`: presenting, its picker showing
	 * the folder's name, the IDE window hidden, and exactly one window on
	 * screen.
	 */
	async expectCanvasSettled(folder: string, timeout = 90_000): Promise<void> {
		const name = path.basename(this.folder(folder));
		await this.canvas.expectReady({ workspaceName: name, timeout });
		await expect.poll(async () => {
			const windows = await this.windows();
			const visible = windows.filter(w => w.visible && !w.minimized);
			const ide = await this.ideWindow();
			return {
				canvasActive: await this.canvas.isActive().catch(() => false),
				ideVisible: ide.visible,
				visibleCount: visible.length,
			};
		}, { timeout, message: `Canvas never settled on ${name}` }).toEqual({ canvasActive: true, ideVisible: false, visibleCount: 1 });
	}

	/** Waits until the IDE is showing `folder` with Canvas not presenting. */
	async expectIdeSettled(folder: string, timeout = 60_000): Promise<void> {
		const name = path.basename(this.folder(folder));
		await expect.poll(async () => {
			const ide = await this.ideWindow();
			return {
				canvasActive: await this.canvas.isActive().catch(() => undefined),
				ideVisible: ide.visible,
				ideShowsFolder: titleNamesFolder(ide.title, name),
			};
		}, { timeout, message: `The IDE never settled on ${name}` }).toEqual({ canvasActive: false, ideVisible: true, ideShowsFolder: true });
	}

	// --- Dialogs ---

	/**
	 * Answers the folder dialog that "Open existing folder..." opened with
	 * `folder`. Under `--enable-smoke-test-driver` the workbench always uses its
	 * simple file dialog, a quick input in the window that asked (here the
	 * Canvas window), never the native one (fileDialogService.ts), so it is
	 * driven like any quick input.
	 */
	async answerFolderDialog(folder: string): Promise<void> {
		const folderPath = this.folder(folder);
		const dialog = (await this.canvas.page()).locator('.quick-input-widget');
		await expect(dialog, 'the folder dialog did not open in the Canvas window').toBeVisible();
		const input = dialog.locator('.quick-input-box input');
		await input.fill(`${folderPath}/`);
		await expect(input).toHaveValue(`${folderPath}/`);
		// The accept button carries the caller's label ("Open Canvas workspace").
		await dialog.locator('.quick-input-action .monaco-text-button').filter({ hasText: /\S/ }).first().click();
		await expect(dialog).toBeHidden();
	}

	// --- Folder switch ---

	/**
	 * Asks Canvas to switch to `target` and waits for the outcome: the IDE
	 * window's document replaced by the new folder's (then Canvas settled
	 * there), or a refusal. `picker` clicks the workspace menu row, `dialog`
	 * uses "Open existing folder..." and answers its folder dialog, `command`
	 * calls `positron.experimental.switchCanvasFolder` directly.
	 */
	async switchFolder(target: string, via: SwitchRoute = 'picker', timeout = 120_000): Promise<SwitchOutcome> {
		const folderPath = this.folder(target);
		this.snapshotExtensionLogs(`before-switch-to-${path.basename(folderPath)}`);
		const started = Date.now();
		const marker = await this.code.driver.markWindowForReload();
		let commandError: string | undefined;
		if (via === 'picker') {
			await this.canvas.clickWorkspaceRow(folderPath);
		} else if (via === 'dialog') {
			await this.canvas.clickOpenExistingFolder();
			await this.answerFolderDialog(folderPath);
		} else {
			// The calling document goes away when the switch is accepted, so the
			// call often never settles; only a rejection from a live document counts.
			void this.code.driver.executeCommand('positron.experimental.switchCanvasFolder', folderPath).catch(error => {
				const message = String(error?.message ?? error);
				// "Canceled" is the IPC to the unloading document being dropped.
				if (!/context was destroyed|Target (page, context or browser )?closed|navigat|Canceled/i.test(message)) {
					commandError = message.replace(/^.*?Error: /s, '').split('\n')[0];
				}
			});
		}

		const page = this.code.driver.currentPage;
		const deadline = started + timeout;
		while (Date.now() < deadline) {
			const reloaded = await page.evaluate(m => !(window as unknown as Record<string, boolean>)[m], marker).catch(() => false);
			if (reloaded) {
				await this.waitForIdeWindow();
				await this.expectCanvasSettled(folderPath, Math.max(deadline - Date.now(), 1_000));
				return { switched: true, ms: Date.now() - started };
			}
			const refusal = commandError ?? await this.canvas.refusal().catch(() => undefined);
			if (refusal) {
				return { switched: false, refusal, ms: Date.now() - started };
			}
			await delay(250);
		}
		throw new Error(`Switching Canvas to ${folderPath} neither loaded the folder nor was refused within ${timeout}ms`);
	}

	// --- Artifacts ---

	/**
	 * Screenshots every on-screen window to `<artifacts>/shots/NN-label-wID.png`.
	 * Hidden windows are skipped: they may produce no frames to capture.
	 */
	async shot(label: string): Promise<string[]> {
		const n = String(++this.shotCount).padStart(2, '0');
		const dir = path.join(this.options.artifactsDir, 'shots');
		fs.mkdirSync(dir, { recursive: true });
		const saved: string[] = [];
		const onScreen = new Set((await this.windows()).filter(w => w.visible && !w.minimized).map(w => w.id));
		for (const page of this.code.electronApp!.windows()) {
			const id = await page.evaluate(() => (window as unknown as { vscodeWindowId?: number }).vscodeWindowId).catch(() => undefined);
			if (id === undefined || !onScreen.has(id)) {
				continue;
			}
			const file = path.join(dir, `${n}-${label.replace(/[^\w.-]+/g, '_')}-w${id}.png`);
			await page.screenshot({ path: file, timeout: 10_000 }).then(() => saved.push(file), error => this.logger.log(`shot ${file}: ${error}`));
		}
		return saved;
	}

	/**
	 * Copies the extension log channels (`exthost/<extension id>/` in each
	 * window's log dir) to `<launch>/extension-logs/NN-label/`. The extension host log appends
	 * across folder loads, but each extension's own channel starts over when
	 * it activates in the new folder.
	 */
	snapshotExtensionLogs(label: string): void {
		const logs = path.join(this.launchDir, 'logs');
		const dest = path.join(this.launchDir, 'extension-logs', `${String(++this.shotCount).padStart(2, '0')}-${label}`);
		for (const windowDir of fs.existsSync(logs) ? fs.readdirSync(logs).filter(d => d.startsWith('window')) : []) {
			const exthost = path.join(logs, windowDir, 'exthost');
			for (const ext of fs.existsSync(exthost) ? fs.readdirSync(exthost, { withFileTypes: true }) : []) {
				if (ext.isDirectory() && !ext.name.startsWith('output_logging')) {
					fs.cpSync(path.join(exthost, ext.name), path.join(dest, windowDir, ext.name), { recursive: true });
				}
			}
		}
	}

	/** The running launch's artifacts dir (logs, videos, trace). */
	get currentLaunchDir(): string {
		return this.launchDir;
	}
}

// --- Helpers ---

/**
 * Whether a window title (`[Extension Development Host] editor - folder - ...`)
 * has `name` as one of its segments.
 */
export function titleNamesFolder(title: string, name: string): boolean {
	return title.replace(/^\[Extension Development Host\]\s*/, '').split(/\s+[-\u2014]\s+/).includes(name);
}

function fileUri(p: string): string {
	return `file://${p.split(path.sep).map(encodeURIComponent).join('/')}`;
}

function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/** The environment a launch from sources needs (set by prepareTestEnv under the runner). */
function devEnv(): Record<string, string> {
	return process.env.BUILD ? {} : { VSCODE_DEV: '1', VSCODE_CLI: '1', VSCODE_REPOSITORY: REPO_ROOT };
}

function processExit(code: Code): Promise<void> {
	const child = code.electronApp!.process();
	return child.exitCode !== null || child.signalCode !== null
		? Promise.resolve()
		: new Promise(resolve => child.once('exit', () => resolve()));
}

function vsixVersion(vsixPath: string): string {
	const manifest = cp.execFileSync('unzip', ['-p', vsixPath, 'extension/package.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return JSON.parse(manifest).version;
}

/** The built-in assistant a launch would load, if there is one. */
function builtinAssistantVersion(): { path: string; version: string } | undefined {
	const candidates = process.env.BUILD
		? [path.join(process.env.BUILD, 'Contents', 'Resources', 'app', 'extensions', ASSISTANT_ID)]
		: [path.join(REPO_ROOT, '.build', 'builtInExtensions', ASSISTANT_ID)];
	for (const candidate of candidates) {
		const manifest = path.join(candidate, 'package.json');
		if (fs.existsSync(manifest)) {
			return { path: candidate, version: JSON.parse(fs.readFileSync(manifest, 'utf8')).version };
		}
	}
	return undefined;
}

function installedExtensions(extensionsDir: string): { id: string; version: string }[] {
	const manifest = path.join(extensionsDir, 'extensions.json');
	if (!fs.existsSync(manifest)) {
		return [];
	}
	return (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { identifier: { id: string }; version: string }[])
		.map(e => ({ id: e.identifier.id.toLowerCase(), version: e.version }));
}

function compareVersions(a: string, b: string): number {
	const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0);
	const pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
	for (let i = 0; i < 3; i++) {
		if (pa[i] !== pb[i]) {
			return pa[i] - pb[i];
		}
	}
	return 0;
}
