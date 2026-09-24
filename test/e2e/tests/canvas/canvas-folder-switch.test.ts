/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Positron-hosted Canvas: booting into Canvas, switching its folder from the
// Canvas workspace picker, the switch's refusals, and relaunching into Canvas.
// The smoke these automate is in the Canvas README
// (src/vs/workbench/contrib/positronCanvas/README.md, "Opening another folder
// from Canvas"). Needs a Canvas-capable Posit Assistant; see README.md here.

import * as fs from 'fs';
import * as path from 'path';
import { CanvasHarness } from '../../infra/canvasHarness';
import { expect, tags, test } from './_canvas.setup';

/**
 * The longest two windows may share the screen. Every hand-off between the
 * IDE window and the Canvas window overlaps them for a moment (one is shown
 * before the other is hidden, 30-150 ms locally); a window that stays up
 * next to another for longer is a visible flash.
 */
const MAX_OVERLAP_MS = 750;

// Each test launches (and relaunches) Positron on a fresh profile.
test.describe.configure({ timeout: 5 * 60_000 });

test.describe('Canvas: folder switch', { tag: [tags.CANVAS] }, () => {

	test.skip(process.platform !== 'darwin', 'Canvas runs in desktop Positron; the harness is only verified on macOS');

	test('boots into Canvas and switches A -> B -> C -> A in the same native window', async ({ harness, step }) => {
		const { A, B, C } = harness.folders;

		await step('Boot into Canvas on A', async () => {
			await harness.launch({ folder: 'A', canvas: true });
			await harness.expectCanvasSettled('A');
			// Recents come from this profile's shared storage only, not the machine's.
			expect(await harness.canvas.recentFolders()).toEqual([A, B, C]);
		});
		const ideWindowId = (await harness.ideWindow()).id;

		await step('The workspace menu lists the recent folders', async () => {
			const rows = await harness.canvas.workspaceRows();
			expect(rows.map(r => r.text)).toEqual([`A | Current | ${A}`, `B | ${B}`, `C | ${C}`]);
			await harness.canvas.closeWorkspaceMenu();
		});

		const hops = [['B', 'picker'], ['C', 'dialog'], ['A', 'picker']] as const;
		for (const [target, via] of hops) {
			await step(`Switch to ${target} (${via})`, async () => {
				const started = Date.now();
				const outcome = await harness.switchFolder(target, via);
				expect(outcome).toMatchObject({ switched: true });
				test.info().annotations.push({ type: 'switch timing', description: `-> ${target} via ${via}: ${outcome.ms} ms` });
				// The folder loads into the IDE window; only the Canvas window is new.
				expect((await harness.ideWindow()).id).toBe(ideWindowId);
				await expectNoFlash(harness, started);
			});
		}
	});

	test('a switch shuts down the source runtime and starts the destination fresh', async ({ harness, step }) => {
		const { B, C } = harness.folders;
		// Page objects are per launch, so read them when used.
		const ide = () => harness.workbench;
		let kernelPid = 0;

		await step('Start Python in B and note its working directory and process', async () => {
			await harness.launch({ folder: 'B' });
			await startPython(harness);
			await ide().console.executeCode('Python', 'import os; canvas_marker = 42; print(f"cwd={os.getcwd()} pid={os.getpid()}")');
			const [line] = await ide().console.waitForConsoleContents(/cwd=.* pid=\d+/);
			expect(line).toContain(`cwd=${B}`);
			kernelPid = Number(/pid=(\d+)/.exec(line)![1]);
			expect(isAlive(kernelPid)).toBe(true);
		});

		await step('Enter Canvas and switch to C', async () => {
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('B');
			expect(await harness.switchFolder('C')).toMatchObject({ switched: true });
		});

		await step('The B kernel is gone', async () => {
			await expect.poll(() => isAlive(kernelPid), { timeout: 30_000 }).toBe(false);
		});

		// Not "C has no sessions": the assistant starts an R session of its own
		// whenever its Canvas panel boots.
		await step('Open Positron: a new Python session starts in C without B state', async () => {
			expect(await harness.canvas.exit()).toBe(true);
			await harness.expectIdeSettled('C');
			await startPython(harness);
			await ide().console.executeCode('Python', 'import os; print(f"cwd={os.getcwd()} marker={\'canvas_marker\' in globals()}")');
			await ide().console.waitForConsoleContents(`cwd=${C} marker=False`);
		});
	});

	test('refuses a switch while a runtime is busy, and changes nothing', async ({ harness, step }) => {
		let recents: string[] = [];
		let pythonSession = '';

		await step('Start a long Python computation in A, then enter Canvas', async () => {
			await harness.launch({ folder: 'A' });
			pythonSession = await startPython(harness);
			await harness.workbench.console.executeCode('Python', 'import time; time.sleep(600)', { waitForReady: false });
			await harness.workbench.console.waitForExecutionStarted();
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('A');
			recents = await harness.canvas.recentFolders();
		});

		await step('Picking B is refused with the busy session named', async () => {
			const outcome = await harness.switchFolder('B');
			expect(outcome).toMatchObject({ switched: false, refusal: expect.stringMatching(/Python .*session is busy/) });
			await expectUnchanged(harness, 'A', recents);
		});

		await step('After interrupting, the switch goes through', async () => {
			await harness.canvas.dismissRefusal();
			expect(await harness.canvas.exit()).toBe(true);
			// The assistant's own R session may be in the foreground by now.
			await harness.workbench.sessions.select(pythonSession);
			await harness.workbench.console.interruptExecution();
			await harness.workbench.console.waitForReady('>>>');
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('A');
			expect(await harness.switchFolder('B')).toMatchObject({ switched: true });
		});
	});

	test('refuses a switch with unsaved changes, and changes nothing', async ({ harness, step }) => {
		let recents: string[] = [];

		// An untitled buffer: entering Canvas saves dirty files (see the next test).
		await step('Leave an unsaved untitled editor in A, then enter Canvas', async () => {
			await harness.launch({ folder: 'A' });
			await harness.code.driver.executeCommand('workbench.action.files.newUntitledFile');
			await harness.code.driver.currentPage.keyboard.type('unsaved');
			await expect(harness.code.driver.currentPage.locator('.tab.dirty')).toHaveCount(1);
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('A');
			recents = await harness.canvas.recentFolders();
		});

		await step('Picking B is refused', async () => {
			const outcome = await harness.switchFolder('B');
			expect(outcome).toMatchObject({ switched: false, refusal: expect.stringContaining('Save or discard your unsaved changes') });
			await expectUnchanged(harness, 'A', recents);
		});

		await step('After reverting, the switch goes through', async () => {
			await harness.canvas.dismissRefusal();
			expect(await harness.canvas.exit()).toBe(true);
			// Open Positron merges the Canvas editor back in; make the untitled one active.
			await harness.code.driver.currentPage.locator('.tab.dirty').click();
			await harness.code.driver.executeCommand('workbench.action.revertAndCloseActiveEditor');
			await expect(harness.code.driver.currentPage.locator('.tab.dirty')).toHaveCount(0);
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('A');
			expect(await harness.switchFolder('B')).toMatchObject({ switched: true });
		});
	});

	test('entering Canvas leaves unsaved edits to workspace files unsaved', async ({ harness, step }) => {
		const notes = path.join(harness.folders.A, 'notes.txt');
		fs.writeFileSync(notes, 'saved\n');

		await step('Edit a file in A without saving', async () => {
			await harness.launch({ folder: 'A' });
			await harness.workbench.quickaccess.openFile(notes);
			await harness.code.driver.currentPage.keyboard.type('unsaved ');
			await expect(harness.code.driver.currentPage.locator('.tab.dirty')).toHaveCount(1);
		});

		await step('Enter Canvas: the edit is still unsaved', async () => {
			expect(await harness.canvas.enter()).toEqual({ entered: true });
			await harness.expectCanvasSettled('A');
			// Give a save that entry might trigger time to land.
			await harness.code.wait(3_000);
			expect(fs.readFileSync(notes, 'utf8'), 'entering Canvas wrote the unsaved edit to disk').toBe('saved\n');
		});
	});

	test.fixme('chat works in the destination after a switch', async () => {
		// Needs a language model. Positron-hosted Canvas has no mock provider yet
		// (the e2e echo provider is Positron Assistant's, not Posit Assistant's),
		// so this stays manual: switch, send a message, get a reply in the new folder.
	});
});

test.describe('Canvas: relaunch', { tag: [tags.CANVAS] }, () => {

	test.skip(process.platform !== 'darwin', 'Canvas runs in desktop Positron; the harness is only verified on macOS');

	// Restoring the last session's windows (and hot exit) only happens without
	// --extensionDevelopmentPath, so these need an installed assistant.
	test.use({ assistantMode: 'vsix' });

	test('relaunches into Canvas after a graceful quit, restored Canvas window held hidden', async ({ harness, step }) => {
		await step('Boot into Canvas on A and switch to C', async () => {
			await harness.launch({ folder: 'A', canvas: true });
			await harness.expectCanvasSettled('A');
			expect(await harness.switchFolder('C')).toMatchObject({ switched: true });
		});

		await step('Quit in Canvas', async () => {
			await harness.quit();
		});

		await step('Relaunch restores C into Canvas, with the IDE hidden and no second window on screen', async () => {
			const started = Date.now();
			await harness.launch({ folder: null });
			await harness.expectCanvasSettled('C');
			await expectNoFlash(harness, started);
			await expectOnlyIdeAndCanvasWindows(harness);
		});

		await step('A, left by a switch, relaunches into the IDE', async () => {
			await harness.quit();
			await harness.launch({ folder: 'A' });
			await harness.expectIdeSettled('A');
		});
	});

	test('relaunches after a hard kill without stray windows', async ({ harness, step }) => {
		await step('Boot into Canvas on A and switch A -> B -> C -> A', async () => {
			await harness.launch({ folder: 'A', canvas: true });
			await harness.expectCanvasSettled('A');
			for (const target of ['B', 'C', 'A']) {
				expect(await harness.switchFolder(target)).toMatchObject({ switched: true });
			}
		});

		await step('Kill the app', async () => {
			await harness.kill();
		});

		await step('Relaunch restores A into Canvas: one IDE window, one Canvas window, nothing else', async () => {
			const started = Date.now();
			await harness.launch({ folder: null });
			await harness.expectCanvasSettled('A');
			await expectNoFlash(harness, started);
			await expectOnlyIdeAndCanvasWindows(harness);
		});
	});
});

test.describe('Canvas: folder switch with workspace trust', { tag: [tags.CANVAS] }, () => {

	test.skip(process.platform !== 'darwin', 'Canvas runs in desktop Positron; the harness is only verified on macOS');

	// B-alias is a symlink to B. Trusting the alias does not trust B itself.
	test.use({ harnessOptions: { workspaceTrust: true, trusted: ['A', 'B-alias'], aliases: { 'B-alias': 'B' } } });

	test('refuses untrusted folders, through a symlink too, and switches once trusted', async ({ harness, step }) => {
		await step('Boot into Canvas on trusted A', async () => {
			await harness.launch({ folder: 'A', canvas: true });
			await harness.expectCanvasSettled('A');
		});

		await step('Untrusted B is refused', async () => {
			const outcome = await harness.switchFolder('B');
			expect(outcome).toMatchObject({ switched: false, refusal: expect.stringContaining(`The folder ${harness.folders.B} is not trusted`) });
			await harness.canvas.dismissRefusal();
		});

		await step('B-alias is refused too: its target B is untrusted', async () => {
			const outcome = await harness.switchFolder('B-alias', 'command');
			expect(outcome).toMatchObject({ switched: false, refusal: expect.stringContaining('is not trusted') });
		});

		await step('Once B is trusted, the switch goes through without a trust prompt', async () => {
			await harness.quit();
			await harness.trust('B');
			await harness.launch({ folder: 'A' });
			// A quit in Canvas, so it boots back into Canvas.
			await harness.expectCanvasSettled('A');
			expect(await harness.switchFolder('B')).toMatchObject({ switched: true });
			await expect(harness.code.driver.currentPage.getByText('Do you trust the authors')).toHaveCount(0);
		});
	});
});

// --- Helpers ---

/**
 * Starts a Python console session and returns its id. Any Python will do: the
 * version is the number in POSITRON_PY_VER_SEL without its source label, which
 * depends on extensions this isolated profile does not have (e.g. "(uv)").
 * Started from the session picker button: after Open Positron the Canvas
 * webview has keyboard focus, so the picker's keybinding goes nowhere.
 */
async function startPython(harness: CanvasHarness): Promise<string> {
	const version = /\d+\.\d+\.\d+/.exec(process.env.POSITRON_PY_VER_SEL ?? '')?.[0];
	return harness.workbench.sessions.startAndSkipMetadata({ language: 'Python', version, triggerMode: 'session-picker' });
}

// --- Assertions ---

/** No two windows stayed on screen together for longer than a hand-off since `since`. */
async function expectNoFlash(harness: CanvasHarness, since: number): Promise<void> {
	const overlaps = await harness.overlapsSince(since);
	const flashes = overlaps.filter(o => o.durationMs > MAX_OVERLAP_MS);
	// Soft, so the steps after a flash still run and report.
	expect.soft(flashes, `windows on screen together for more than ${MAX_OVERLAP_MS} ms (see window-timeline.txt)`).toEqual([]);
}

/** Every native window is the IDE window (hidden) or the Canvas window (shown). */
async function expectOnlyIdeAndCanvasWindows(harness: CanvasHarness): Promise<void> {
	const windows = await harness.windows();
	const ide = await harness.ideWindow();
	const others = windows.filter(w => w.id !== ide.id);
	expect(ide.visible, 'the IDE window is hidden').toBe(false);
	expect(others.map(w => ({ title: w.title, visible: w.visible })), 'exactly one other window, the visible Canvas window')
		.toEqual([{ title: expect.stringMatching(/Canvas/), visible: true }]);
}

/** A refused switch left Canvas on `folder` and the recents as they were. */
async function expectUnchanged(harness: CanvasHarness, folder: string, recents: string[]): Promise<void> {
	await harness.expectCanvasSettled(folder, 5_000);
	expect(await harness.canvas.recentFolders()).toEqual(recents);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
