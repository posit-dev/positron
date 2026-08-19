/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { commands, Disposable, QuickPick, QuickPickItem, window, workspace } from 'vscode';
import { assertNoRpc, closeAllEditors } from '../utils';

interface QuickPickExpected {
	events: string[];
	activeItems: string[][];
	selectionItems: string[][];
	acceptedItems: {
		active: string[][];
		selection: string[][];
		dispose: boolean[];
	};
}

suite('vscode API - quick input', function () {

	teardown(async function () {
		assertNoRpc();
		await closeAllEditors();
	});

	test('createQuickPick, select second', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], ['zwei']],
			selectionItems: [['zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		// --- Start Positron ---
		// (async () => {
		// 	await commands.executeCommand('workbench.action.quickOpenSelectNext');
		// 	await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		// })()
		// 	.catch(err => done(err));
		runCommands([
			'workbench.action.quickOpenSelectNext',
			'workbench.action.acceptSelectedQuickOpenItem',
		], isFinished)
			.catch(err => done(err));
		// --- End Positron ---
	});

	test('createQuickPick, focus second', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'hide'],
			activeItems: [['zwei']],
			selectionItems: [['zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.activeItems = [quickPick.items[1]];
		quickPick.show();

		// --- Start Positron ---
		// (async () => {
		// 	await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		// })()
		// 	.catch(err => done(err));
		runCommands(['workbench.action.acceptSelectedQuickOpenItem'], isFinished)
			.catch(err => done(err));
		// --- End Positron ---
	});

	test('createQuickPick, select first and second', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], ['zwei']],
			selectionItems: [['eins'], ['eins', 'zwei']],
			acceptedItems: {
				active: [['zwei']],
				selection: [['eins', 'zwei']],
				dispose: [true]
			},
		}, (err?: any) => done(err));
		quickPick.canSelectMany = true;
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		// --- Start Positron ---
		// (async () => {
		// 	await commands.executeCommand('workbench.action.quickOpenSelectNext');
		// 	await commands.executeCommand('workbench.action.quickPickManyToggle');
		// 	await commands.executeCommand('workbench.action.quickOpenSelectNext');
		// 	await commands.executeCommand('workbench.action.quickPickManyToggle');
		// 	await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		// })()
		// 	.catch(err => done(err));
		runCommands([
			'workbench.action.quickOpenSelectNext',
			'workbench.action.quickPickManyToggle',
			'workbench.action.quickOpenSelectNext',
			'workbench.action.quickPickManyToggle',
			'workbench.action.acceptSelectedQuickOpenItem',
		], isFinished)
			.catch(err => done(err));
		// --- End Positron ---
	});

	test('createQuickPick, selection events', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'selection', 'accept', 'hide'],
			activeItems: [['eins']],
			selectionItems: [['zwei'], ['drei']],
			acceptedItems: {
				active: [['eins'], ['eins']],
				selection: [['zwei'], ['drei']],
				dispose: [false, true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei', 'drei'].map(label => ({ label }));
		quickPick.show();

		quickPick.selectedItems = [quickPick.items[1]];
		setTimeout(() => {
			quickPick.selectedItems = [quickPick.items[2]];
		}, 0);
	});

	test('createQuickPick, continue after first accept', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'active', 'selection', 'accept', 'hide'],
			activeItems: [['eins'], ['drei']],
			selectionItems: [['eins'], ['drei']],
			acceptedItems: {
				active: [['eins'], ['drei']],
				selection: [['eins'], ['drei']],
				dispose: [false, true]
			},
		}, (err?: any) => done(err));
		quickPick.items = ['eins', 'zwei'].map(label => ({ label }));
		quickPick.show();

		(async () => {
			// --- Start Positron ---
			// await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
			await runCommands(['workbench.action.acceptSelectedQuickOpenItem'], isFinished);
			// --- End Positron ---
			await timeout(async () => {
				// --- Start Positron ---
				// Don't touch the pick once the test is over: by then the visible quick
				// input belongs to the next test.
				if (isFinished()) {
					return;
				}
				// --- End Positron ---
				quickPick.items = ['drei', 'vier'].map(label => ({ label }));
				await timeout(async () => {
					// --- Start Positron ---
					// await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
					await runCommands(['workbench.action.acceptSelectedQuickOpenItem'], isFinished);
					// --- End Positron ---
				}, 0);
			}, 0);
		})()
			.catch(err => done(err));
	});

	test('createQuickPick, dispose in onDidHide', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		let hidden = false;
		const quickPick = window.createQuickPick();
		quickPick.onDidHide(() => {
			if (hidden) {
				done(new Error('Already hidden'));
			} else {
				hidden = true;
				quickPick.dispose();
				setTimeout(done, 0);
			}
		});
		quickPick.show();
		quickPick.hide();
	});

	test('createQuickPick, hide and dispose', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		let hidden = false;
		const quickPick = window.createQuickPick();
		quickPick.onDidHide(() => {
			if (hidden) {
				done(new Error('Already hidden'));
			} else {
				hidden = true;
				setTimeout(done, 0);
			}
		});
		quickPick.show();
		quickPick.hide();
		quickPick.dispose();
	});

	test('createQuickPick, hide and hide', function (_done) {
		let done = (err?: any) => {
			done = () => { };
			_done(err);
		};

		let hidden = false;
		const quickPick = window.createQuickPick();
		quickPick.onDidHide(() => {
			if (hidden) {
				done(new Error('Already hidden'));
			} else {
				hidden = true;
				setTimeout(done, 0);
			}
		});
		quickPick.show();
		quickPick.hide();
		quickPick.hide();
	});

	test('createQuickPick, hide show hide', async function () {
		async function waitForHide(quickPick: QuickPick<QuickPickItem>) {
			let disposable: Disposable | undefined;
			try {
				await Promise.race([
					new Promise(resolve => disposable = quickPick.onDidHide(() => resolve(true))),
					new Promise((_, reject) => setTimeout(() => reject(), 4000))
				]);
			} finally {
				disposable?.dispose();
			}
		}

		const quickPick = window.createQuickPick();
		quickPick.show();
		const promise = waitForHide(quickPick);
		quickPick.hide();
		quickPick.show();
		await promise;
		quickPick.hide();
		await waitForHide(quickPick);
	});

	test('createQuickPick, match item by label derived from resourceUri', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'hide'],
			activeItems: [['']],
			selectionItems: [['']],
			acceptedItems: {
				active: [['']],
				selection: [['']],
				dispose: [true]
			},
		}, (err?: any) => done(err));

		const baseUri = workspace!.workspaceFolders![0].uri;
		quickPick.items = [
			{ label: 'a1', resourceUri: baseUri.with({ path: baseUri.path + '/test1.txt' }) },
			{ label: '', resourceUri: baseUri.with({ path: baseUri.path + '/test2.txt' }) },
			{ label: 'a3', resourceUri: baseUri.with({ path: baseUri.path + '/test3.txt' }) }
		];
		quickPick.value = 'test2.txt';
		quickPick.show();

		// --- Start Positron ---
		// (async () => {
		// 	await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		// })()
		// 	.catch(err => done(err));
		runCommands(['workbench.action.acceptSelectedQuickOpenItem'], isFinished)
			.catch(err => done(err));
		// --- End Positron ---
	});

	test('createQuickPick, match item by description derived from resourceUri', function (_done) {
		// --- Start Positron ---
		// let done = (err?: any) => {
		// 	done = () => { };
		// 	_done(err);
		// };
		const { done, isFinished } = onceDone(_done);
		// --- End Positron ---

		const quickPick = createQuickPick({
			events: ['active', 'selection', 'accept', 'hide'],
			activeItems: [['a2']],
			selectionItems: [['a2']],
			acceptedItems: {
				active: [['a2']],
				selection: [['a2']],
				dispose: [true]
			},
		}, (err?: any) => done(err));

		const baseUri = workspace!.workspaceFolders![0].uri;
		quickPick.items = [
			{ label: 'a1', resourceUri: baseUri.with({ path: baseUri.path + '/test1.txt' }) },
			{ label: 'a2', resourceUri: baseUri.with({ path: baseUri.path + '/test2.txt' }) },
			{ label: 'a3', resourceUri: baseUri.with({ path: baseUri.path + '/test3.txt' }) }
		];
		quickPick.matchOnDescription = true;
		quickPick.value = 'test2.txt';
		quickPick.show();

		// --- Start Positron ---
		// (async () => {
		// 	await commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
		// })()
		// 	.catch(err => done(err));
		runCommands(['workbench.action.acceptSelectedQuickOpenItem'], isFinished)
			.catch(err => done(err));
		// --- End Positron ---
	});
});

function createQuickPick(expected: QuickPickExpected, done: (err?: any) => void, record = false) {
	const quickPick = window.createQuickPick();
	// --- Start Positron ---
	// These tests assert an exact event sequence and none of them exercise focus-out
	// behaviour. With the default (false), any unrelated workbench activity that moves
	// DOM focus while the pick is open closes it, and the resulting onDidHide lands in
	// the middle of the expected sequence.
	// See https://github.com/posit-dev/positron/issues/15536.
	quickPick.ignoreFocusOut = true;
	// --- End Positron ---
	let eventIndex = -1;
	quickPick.onDidChangeActive(items => {
		if (record) {
			console.log(`active: [${items.map(item => item.label).join(', ')}]`);
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('active', expected.events.shift(), `onDidChangeActive (event ${eventIndex})`);
			const expectedItems = expected.activeItems.shift();
			assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeActive event items (event ${eventIndex})`);
			assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedItems, `onDidChangeActive active items (event ${eventIndex})`);
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidChangeSelection(items => {
		if (record) {
			console.log(`selection: [${items.map(item => item.label).join(', ')}]`);
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('selection', expected.events.shift(), `onDidChangeSelection (event ${eventIndex})`);
			const expectedItems = expected.selectionItems.shift();
			assert.deepStrictEqual(items.map(item => item.label), expectedItems, `onDidChangeSelection event items (event ${eventIndex})`);
			assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedItems, `onDidChangeSelection selected items (event ${eventIndex})`);
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidAccept(() => {
		if (record) {
			console.log('accept');
			return;
		}
		try {
			eventIndex++;
			assert.strictEqual('accept', expected.events.shift(), `onDidAccept (event ${eventIndex})`);
			const expectedActive = expected.acceptedItems.active.shift();
			assert.deepStrictEqual(quickPick.activeItems.map(item => item.label), expectedActive, `onDidAccept active items (event ${eventIndex})`);
			const expectedSelection = expected.acceptedItems.selection.shift();
			assert.deepStrictEqual(quickPick.selectedItems.map(item => item.label), expectedSelection, `onDidAccept selected items (event ${eventIndex})`);
			if (expected.acceptedItems.dispose.shift()) {
				quickPick.dispose();
			}
		} catch (err) {
			done(err);
		}
	});
	quickPick.onDidHide(() => {
		if (record) {
			console.log('hide');
			done();
			return;
		}
		try {
			// --- Start Positron ---
			// Name the event: a bare `'hide' !== 'active'` gives no hint that an
			// unexpected hide interrupted the sequence.
			// assert.strictEqual('hide', expected.events.shift());
			assert.strictEqual('hide', expected.events.shift(), `onDidHide (remaining expected events after this one: [${expected.events.join(', ')}])`);
			// --- End Positron ---
			done();
		} catch (err) {
			done(err);
		}
	});

	return quickPick;
}

async function timeout<T>(run: () => Promise<T> | T, ms: number): Promise<T> {
	return new Promise<T>(resolve => setTimeout(() => resolve(run()), ms));
}

// --- Start Positron ---
/**
 * Wrap mocha's `done` so that it fires at most once (as the inline wrappers this
 * replaces did) and also reports whether the test has finished. See runCommands.
 */
function onceDone(_done: (err?: any) => void) {
	let finished = false;
	return {
		done: (err?: any) => {
			if (finished) {
				return;
			}
			finished = true;
			_done(err);
		},
		isFinished: () => finished,
	};
}

/**
 * Execute commands in order, stopping as soon as the test has finished.
 *
 * These commands act on whichever quick input is currently visible, not on a
 * particular one. When a test ends early -- an unexpected hide, a failed assertion --
 * mocha moves straight on, so a command still queued here would be delivered to the
 * *next* test's quick pick and fail that test too, for reasons that have nothing to
 * do with it. See https://github.com/posit-dev/positron/issues/15536.
 */
async function runCommands(ids: string[], isFinished: () => boolean): Promise<void> {
	for (const id of ids) {
		if (isFinished()) {
			return;
		}
		await commands.executeCommand(id);
	}
}
// --- End Positron ---
