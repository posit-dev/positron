/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IQuickInputService, IQuickPickItem, QuickInputHideReason, QuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimePickerContribution, IRuntimePickerItem, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestQuickPick } from '../../../../../test/vitest/testQuickPick.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DuplicateActiveConsoleSessionAction, selectLanguageRuntimeSession, selectNewLanguageRuntime } from '../../browser/languageRuntimeActions.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IRuntimeSessionService, ILanguageRuntimeSession, RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID, SELECT_KERNEL_ID_POSITRON } from '../../../positronNotebook/common/positronNotebookCommon.js';

function makeRuntime(overrides: Partial<ILanguageRuntimeMetadata> = {}): ILanguageRuntimeMetadata {
	const languageId = overrides.languageId ?? 'python';
	const base: ILanguageRuntimeMetadata = {
		extensionId: new ExtensionIdentifier('test-extension'),
		base64EncodedIconSvg: '',
		extraRuntimeData: { supported: true },
		runtimeId: `${languageId}-${Math.random().toString(36).slice(2)}`,
		runtimePath: '/usr/bin/test',
		runtimeVersion: '0.0.0',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
		languageId,
		languageName: 'Python',
		languageVersion: '3.12.0',
		runtimeName: 'Python 3.12 (System)',
		runtimeShortName: '3.12',
		runtimeSource: 'System',
	};
	return { ...base, ...overrides };
}

describe('selectNewLanguageRuntime', () => {
	let preferredByLanguage: Map<string, ILanguageRuntimeMetadata>;
	// `pick` is reassigned in beforeEach (and once mid-test in the title fallback
	// case). The IQuickInputService stub captures it by closure so each
	// createQuickPick() call returns whichever double is current.
	let pick: TestQuickPick<IQuickPickItem>;

	// Stubbed at describe scope so vi.spyOn can attach in individual tests.
	const rediscoverAllRuntimes = vi.fn(async (_quiet?: boolean) => undefined);

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, {
			getPreferredRuntime: (langId: string) => preferredByLanguage.get(langId),
			rediscoverAllRuntimes,
		})
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			// Narrow to IQuickInputService['createQuickPick'] because the field is
			// overloaded ({useSeparators: true} vs default false); our single-shape
			// stub function only satisfies one overload and TS rejects it without
			// the cast.
			createQuickPick: (() => pick.asQuickPick()) as IQuickInputService['createQuickPick'],
		}))
		.build();

	beforeEach(() => {
		preferredByLanguage = new Map();
		pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
		ctx.get(ILanguageRuntimeService).setStartupPhase(RuntimeStartupPhase.Complete);
	});

	function runPicker(options?: Parameters<typeof selectNewLanguageRuntime>[1]) {
		return ctx.instantiationService.invokeFunction(accessor => selectNewLanguageRuntime(accessor, options));
	}

	// The helper builds the runtime rows synchronously and calls pick.show()
	// immediately; contributed items (from picker contributions) are fetched
	// afterwards and folded in via a rebuild, so they may not be present the
	// instant show() is called. Poll for show() before reading runtime rows;
	// poll again (vi.waitFor) when asserting on contributed items.
	async function waitUntilOpened(): Promise<void> {
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());
	}

	async function registerRuntime(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		const runtimeService = ctx.get(ILanguageRuntimeService);
		ctx.disposables.add(runtimeService.registerRuntime(metadata));
		if (!preferredByLanguage.has(metadata.languageId)) {
			preferredByLanguage.set(metadata.languageId, metadata);
		}
		// registerRuntime enriches the metadata into a new object (e.g. adds
		// runtimeDisplayPath); return the stored instance the picker resolves to.
		return runtimeService.getRegisteredRuntime(metadata.runtimeId) ?? metadata;
	}

	function pickItemById(id: string): IQuickPickItem | undefined {
		return pick.items.find(
			(item): item is IQuickPickItem => item.type !== 'separator' && item.id === id,
		);
	}

	function pickItemByLabel(label: string): IQuickPickItem | undefined {
		return pick.items.find(
			(item): item is IQuickPickItem => item.type !== 'separator' && item.label === label,
		);
	}

	// Contributed items are fetched after show() and folded in via a rebuild,
	// so tests must poll for them rather than reading synchronously.
	async function waitForItemByLabel(label: string): Promise<IQuickPickItem> {
		await vi.waitFor(() => expect(pickItemByLabel(label)).toBeDefined());
		return pickItemByLabel(label)!;
	}


	describe('resolution', () => {
		it('resolves undefined when the picker is hidden without acceptance', async () => {
			const promise = runPicker();
			await waitUntilOpened();
			pick.cancel(QuickInputHideReason.Gesture);
			await expect(promise).resolves.toBeUndefined();
		});

		it('resolves to the selected runtime metadata', async () => {
			const py = await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const promise = runPicker();
			await waitUntilOpened();
			const item = pickItemById('py-1')!;
			pick.accept(item);
			await expect(promise).resolves.toEqual(py);
		});

		it('uses options.title when provided, defaults otherwise', async () => {
			const promise1 = runPicker({ title: 'Pick something' });
			await waitUntilOpened();
			expect(pick.title).toBe('Pick something');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise1;

			pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
			const promise2 = runPicker();
			await waitUntilOpened();
			expect(pick.title).toBe('Start New Interpreter Session');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise2;
		});
	});

	describe('options.languageId', () => {
		it('filters runtimes to the given languageId', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1', languageId: 'python', languageName: 'Python' }));
			await registerRuntime(makeRuntime({ runtimeId: 'r-1', languageId: 'r', languageName: 'R', runtimeName: 'R 4.4' }));

			const promise = runPicker({ languageId: 'python' });
			await waitUntilOpened();
			const ids = pick.items
				.filter((item): item is IQuickPickItem => item.type !== 'separator')
				.map(item => item.id);
			expect(ids).toContain('py-1');
			expect(ids).not.toContain('r-1');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('passes languageId through to getPickerContributions', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const spy = vi.spyOn(ctx.get(ILanguageRuntimeService), 'getPickerContributions');
			const promise = runPicker({ languageId: 'python' });
			await waitUntilOpened();
			expect(spy).toHaveBeenCalledWith('python');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});

	describe('options.currentRuntimeId', () => {
		it('pre-focuses the matching item via activeItems', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0', runtimeName: 'Python 3.10' }));

			const promise = runPicker({ currentRuntimeId: 'py-2' });
			await waitUntilOpened();
			expect(pick.activeItems).toHaveLength(1);
			expect(pick.activeItems[0].id).toBe('py-2');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('leaves activeItems untouched when no item matches the id', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const promise = runPicker({ currentRuntimeId: 'unknown-id' });
			await waitUntilOpened();
			expect(pick.activeItems).toEqual([]);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});

	describe('item structure', () => {
		it('groups Suggested + per-environment-type runtimes with separators', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeName: 'Python (Conda)' }));

			const promise = runPicker();
			await waitUntilOpened();
			const shape = pick.items.map(item =>
				item.type === 'separator' ? `[${item.label}]` : `${item.id}=${item.label}`
			);
			expect(shape).toMatchInlineSnapshot(`
				[
				  "[Suggested]",
				  "py-system=Python (System)",
				  "[System]",
				  "py-system=Python (System)",
				  "[Conda]",
				  "py-conda=Python (Conda)",
				]
			`);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('sorts within an env type by version descending, unsupported runtimes last', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-310', languageVersion: '3.10.0', runtimeName: 'Python 3.10' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-312', languageVersion: '3.12.0', runtimeName: 'Python 3.12' }));
			await registerRuntime(makeRuntime({
				runtimeId: 'py-old', languageVersion: '3.8.0', runtimeName: 'Python 3.8 (unsupported)',
				extraRuntimeData: { supported: false },
			}));

			const promise = runPicker();
			await waitUntilOpened();
			// Find the System group (everything is runtimeSource: 'System' here) and read the order after the separator.
			const items = pick.items;
			const systemIdx = items.findIndex(i => i.type === 'separator' && i.label === 'System');
			const groupIds = items.slice(systemIdx + 1)
				.filter((item): item is IQuickPickItem => item.type !== 'separator')
				.map(item => item.id);
			expect(groupIds).toEqual(['py-312', 'py-310', 'py-old']);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});

	describe('reactive rebuild', () => {
		it('rebuilds when onDidRegisterRuntime fires mid-pick', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const promise = runPicker();
			await waitUntilOpened();
			expect(pickItemById('py-1')).toBeDefined();
			expect(pickItemById('py-2')).toBeUndefined();

			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			expect(pickItemById('py-2')).toBeDefined();
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('rebuilds when onDidUnregisterRuntime fires mid-pick', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			const promise = runPicker();
			await waitUntilOpened();
			expect(pickItemById('py-1')).toBeDefined();
			expect(pickItemById('py-2')).toBeDefined();

			// De-duplication collapsing an alias retracts a runtime while the
			// picker is open; the removed runtime must drop out of the rebuilt list.
			ctx.get(ILanguageRuntimeService).unregisterRuntime('py-2');
			expect(pickItemById('py-2')).toBeUndefined();
			expect(pickItemById('py-1')).toBeDefined();
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('preserves the previously focused item across rebuilds', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			const promise = runPicker({ currentRuntimeId: 'py-2' });
			await waitUntilOpened();
			expect(pick.activeItems[0].id).toBe('py-2');

			await registerRuntime(makeRuntime({ runtimeId: 'py-3', languageVersion: '3.13.0' }));
			expect(pick.activeItems[0].id).toBe('py-2');
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});

	describe('startup phase', () => {
		it('re-fetches contributions when phase transitions to Complete', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const runtimeService = ctx.get(ILanguageRuntimeService);
			runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);

			const contribution: IRuntimePickerContribution = {
				handle: 1,
				languageId: 'python',
				getItems: vi.fn(async () => [{ id: 'install-uv', label: 'Install Python via uv' }]),
				onSelect: vi.fn(),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();
			// While in Discovering, contributions are skipped.
			const labels = pick.items.map(i => i.label);
			expect(labels).not.toContain('Install Python via uv');

			runtimeService.setStartupPhase(RuntimeStartupPhase.Complete);
			// The async listener fetches contributions and rebuilds; poll until
			// the contributed item appears in the items array.
			await vi.waitFor(() => {
				const refreshed = pick.items.map(i => i.label);
				expect(refreshed).toContain('Install Python via uv');
			});
			expect(contribution.getItems).toHaveBeenCalled();

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('skips contributions when phase is not yet Complete', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);

			const contribution: IRuntimePickerContribution = {
				handle: 2,
				languageId: 'python',
				getItems: vi.fn(async () => [{ id: 'install-uv', label: 'Install Python via uv' }]),
				onSelect: vi.fn(),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();
			expect(contribution.getItems).not.toHaveBeenCalled();
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('shows a busy spinner and discovering placeholder while phase is not Complete', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));

			const promise = runPicker();
			await waitUntilOpened();
			expect(pick.busy).toBe(true);
			expect(pick.placeholder).toBe('Discovering interpreters...');

			runtimeService.setStartupPhase(RuntimeStartupPhase.Complete);
			// The Complete handler is async (re-fetches contributions); poll for busy to clear.
			await vi.waitFor(() => expect(pick.busy).toBe(false));
			expect(pick.placeholder).toBeUndefined();

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('shows "No interpreters found" when discovery completes with no runtimes', async () => {
			// beforeEach leaves the phase at Complete; register nothing.
			const promise = runPicker();
			await waitUntilOpened();
			expect(pick.busy).toBe(false);
			expect(pick.placeholder).toBe('No interpreters found');

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('does not show a spinner when discovery is already complete on open', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const promise = runPicker();
			await waitUntilOpened();
			expect(pick.busy).toBe(false);
			expect(pick.placeholder).toBeUndefined();

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('toggles the spinner back on when phase leaves Complete while the picker is open', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			// beforeEach leaves the phase at Complete.
			const promise = runPicker();
			await waitUntilOpened();
			expect(pick.busy).toBe(false);

			// Phase leaving Complete (e.g. a user-triggered rediscovery) must flip
			// the spinner back on -- the regression the broadened handler fixes.
			runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);
			expect(pick.busy).toBe(true);
			expect(pick.placeholder).toBe('Discovering interpreters...');

			runtimeService.setStartupPhase(RuntimeStartupPhase.Complete);
			await vi.waitFor(() => expect(pick.busy).toBe(false));

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('shows no empty-state placeholder when only contributed items are present at Complete', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			// beforeEach leaves the phase at Complete; register a contribution but no runtimes.
			const contribution: IRuntimePickerContribution = {
				handle: 8,
				languageId: 'python',
				getItems: async () => [{ id: 'install-uv', label: 'Install Python via uv' }],
				onSelect: vi.fn(),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();

			// A contributed item counts as a selectable row, so once it arrives the
			// empty-state placeholder must NOT appear even though there are no runtimes.
			await waitForItemByLabel('Install Python via uv');
			expect(pick.busy).toBe(false);
			expect(pick.placeholder).toBeUndefined();

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});

	describe('contributed items', () => {
		it('opens the picker immediately without waiting for slow contributed items', async () => {
			// Regression: getItems() is an extension-host RPC that enumerates
			// interpreters and can hang for seconds right after a window reload
			// while the extension host is still activating. The picker previously
			// awaited it before show(), so a slow RPC left the picker invisible --
			// clicking the session button appeared to do nothing. show() must now
			// happen up front, with contributed items folded in once they resolve.
			const runtimeService = ctx.get(ILanguageRuntimeService);
			registerRuntime(makeRuntime({ runtimeId: 'py-1' }));

			let resolveItems!: (items: IRuntimePickerItem[]) => void;
			const contribution: IRuntimePickerContribution = {
				handle: 9,
				languageId: 'python',
				getItems: vi.fn(() => new Promise<IRuntimePickerItem[]>(resolve => { resolveItems = resolve; })),
				onSelect: vi.fn(),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();

			// The picker shows even though getItems() has not resolved: runtimes
			// are visible immediately, the pending contributed item is not.
			await waitUntilOpened();
			expect(contribution.getItems).toHaveBeenCalled();
			expect(pickItemById('py-1')).toBeDefined();
			expect(pickItemByLabel('Install Python via uv')).toBeUndefined();

			// Once the slow RPC resolves, the contributed item folds in.
			resolveItems([{ id: 'install-uv', label: 'Install Python via uv' }]);
			await waitForItemByLabel('Install Python via uv');

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('resolves the registered runtime and triggers a quiet rediscovery on selection', async () => {
			const installedRuntime = makeRuntime({ runtimeId: 'py-installed-by-uv' });
			const runtimeService = ctx.get(ILanguageRuntimeService);

			const contribution: IRuntimePickerContribution = {
				handle: 3,
				languageId: 'python',
				getItems: async () => [{ id: 'install-uv', label: 'Install Python via uv' }],
				onSelect: vi.fn(async () => {
					// Simulate the contribution registering a new runtime as part of onSelect.
					ctx.disposables.add(runtimeService.registerRuntime(installedRuntime));
					return installedRuntime.runtimeId;
				}),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();

			const installItem = await waitForItemByLabel('Install Python via uv');
			pick.accept(installItem);

			// The picker resolves to the enriched, registered instance.
			const result = await promise;
			expect(result).toEqual(runtimeService.getRegisteredRuntime(installedRuntime.runtimeId));
			expect(contribution.onSelect).toHaveBeenCalledWith('install-uv');
			expect(rediscoverAllRuntimes).toHaveBeenCalledWith(/* quiet */ true);
		});

		it('resolves undefined when onSelect returns undefined', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			const contribution: IRuntimePickerContribution = {
				handle: 4,
				languageId: 'python',
				getItems: async () => [{ id: 'install-noop', label: 'No-op installer' }],
				onSelect: vi.fn(async () => undefined),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();

			const item = await waitForItemByLabel('No-op installer');
			pick.accept(item);
			await expect(promise).resolves.toBeUndefined();
		});

		it('resolves undefined and logs when onSelect throws', async () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const runtimeService = ctx.get(ILanguageRuntimeService);
			const contribution: IRuntimePickerContribution = {
				handle: 5,
				languageId: 'python',
				getItems: async () => [{ id: 'install-fail', label: 'Failing installer' }],
				onSelect: vi.fn(async () => { throw new Error('install failed'); }),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(contribution));

			const promise = runPicker();
			await waitUntilOpened();

			const item = await waitForItemByLabel('Failing installer');
			pick.accept(item);
			await expect(promise).resolves.toBeUndefined();
			expect(consoleErrorSpy).toHaveBeenCalled();
		});

		it('skips a contribution whose getItems() rejects', async () => {
			const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
			const runtimeService = ctx.get(ILanguageRuntimeService);

			const failing: IRuntimePickerContribution = {
				handle: 6,
				languageId: 'python',
				getItems: async () => { throw new Error('cannot list items'); },
				onSelect: vi.fn(),
			};
			const working: IRuntimePickerContribution = {
				handle: 7,
				languageId: 'python',
				getItems: async () => [{ id: 'works', label: 'Working option' }],
				onSelect: vi.fn(),
			};
			ctx.disposables.add(runtimeService.registerPickerContribution(failing));
			ctx.disposables.add(runtimeService.registerPickerContribution(working));

			const promise = runPicker();
			await waitUntilOpened();

			await waitForItemByLabel('Working option');
			expect(consoleErrorSpy).toHaveBeenCalled();

			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});
	});
});

describe('selectLanguageRuntimeSession - change notebook session', () => {
	const changeNotebookSessionLabel = 'Change Notebook Session...';

	let pickItems: QuickPickItem[] = [];
	const pickFn = vi.fn(async (items: QuickPickItem[]): Promise<QuickPickItem | undefined> => {
		pickItems = items;
		return undefined; // user cancels by default; specific tests override
	});
	const executeCommand = vi.fn(async () => undefined);

	let foregroundSession: ILanguageRuntimeSession | undefined;
	let activeEditor: EditorInput | undefined;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get foregroundSession() { return foregroundSession; },
			activeSessions: [] as ILanguageRuntimeSession[],
		}))
		.stub(ICommandService, { executeCommand })
		.stub(IModelService, { getModel: () => null })
		.stub(IEditorService, stubInterface<IEditorService>({
			get activeEditor() { return activeEditor; },
		}))
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			// Narrow to IQuickInputService['pick'] because the field is overloaded
			// (canPickMany: true returns Promise<T[]>, canPickMany: false returns
			// Promise<T>); our single-shape stub satisfies only one overload and
			// TS rejects it without the cast.
			pick: pickFn as IQuickInputService['pick'],
		}))
		.build();

	function makeNotebookSession(uri: URI): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			sessionId: 'notebook-session-1',
			metadata: {
				sessionId: 'notebook-session-1',
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: uri,
				createdTimestamp: 0,
				startReason: 'test',
			},
		});
	}

	function makeConsoleSession(): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			sessionId: 'console-session-1',
			metadata: {
				sessionId: 'console-session-1',
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
			},
		});
	}

	function makeEditorInput(typeId: string, uri: URI): EditorInput {
		return stubInterface<EditorInput>({ typeId, resource: uri });
	}

	beforeEach(() => {
		foregroundSession = undefined;
		pickItems = [];
		// Default to the Positron Notebook Editor for tests
		activeEditor = makeEditorInput(POSITRON_NOTEBOOK_EDITOR_INPUT_ID, URI.file('/path/to/notebook.ipynb'));
	});

	function openInterpreterPicker(options?: Parameters<typeof selectLanguageRuntimeSession>[1]) {
		return ctx.instantiationService.invokeFunction(accessor =>
			selectLanguageRuntimeSession(accessor, options));
	}

	function hasChangeNotebookItem(): boolean {
		return pickItems.some(item => item.label === changeNotebookSessionLabel);
	}

	it('shows the item when foreground is an .ipynb notebook session', async () => {
		foregroundSession = makeNotebookSession(URI.file('/path/to/notebook.ipynb'));
		await openInterpreterPicker();
		expect(hasChangeNotebookItem()).toBe(true);
	});

	it('hides the item when foreground is a console session', async () => {
		foregroundSession = makeConsoleSession();
		await openInterpreterPicker();
		expect(hasChangeNotebookItem()).toBe(false);
	});

	it('hides the item when foreground is a Quarto session', async () => {
		// .qmd extension makes isQuartoDocument(path, ...) return true regardless of model.
		foregroundSession = makeNotebookSession(URI.file('/path/to/document.qmd'));
		await openInterpreterPicker();
		expect(hasChangeNotebookItem()).toBe(false);
	});

	it('hides the item when there is no foreground session', async () => {
		foregroundSession = undefined;
		await openInterpreterPicker();
		expect(hasChangeNotebookItem()).toBe(false);
	});

	it('hides the item when caller passes includeNotebookSessions: false', async () => {
		foregroundSession = makeNotebookSession(URI.file('/path/to/notebook.ipynb'));
		await openInterpreterPicker({ includeNotebookSessions: false });
		expect(hasChangeNotebookItem()).toBe(false);
	});

	it('hides the item when the active editor is a legacy notebook editor', async () => {
		foregroundSession = makeNotebookSession(URI.file('/path/to/notebook.ipynb'));
		// 'jupyter-notebook' is the upstream legacy notebook editor input typeId.
		activeEditor = makeEditorInput('jupyter-notebook', URI.file('/path/to/notebook.ipynb'));
		await openInterpreterPicker();
		expect(hasChangeNotebookItem()).toBe(false);
	});

	it('dispatches SELECT_KERNEL_ID_POSITRON when the item is selected', async () => {
		foregroundSession = makeNotebookSession(URI.file('/path/to/notebook.ipynb'));
		// Override pickFn for this test: return the change-notebook item.
		pickFn.mockImplementationOnce(async (items: QuickPickItem[]) => {
			pickItems = items;
			return items.find(item => item.label === changeNotebookSessionLabel);
		});

		const result = await openInterpreterPicker();
		expect(executeCommand).toHaveBeenCalledWith(SELECT_KERNEL_ID_POSITRON);
		expect(result).toBeUndefined();
	});
});

describe('DuplicateActiveConsoleSessionAction', () => {
	const startNewRuntimeSession = vi.fn(async (): Promise<string> => 'new-session-id');
	const executeCommand = vi.fn(async () => undefined);
	const notifyError = vi.fn();
	let foregroundSession: ILanguageRuntimeSession | undefined;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get foregroundSession() { return foregroundSession; },
			startNewRuntimeSession,
		}))
		.stub(ICommandService, { executeCommand })
		.stub(INotificationService, stubInterface<INotificationService>({ error: notifyError }))
		.build();

	beforeEach(() => {
		foregroundSession = undefined;
	});

	function runAction() {
		return ctx.instantiationService.invokeFunction(accessor => new DuplicateActiveConsoleSessionAction().run(accessor));
	}

	function makeConsoleForegroundSession(): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({ runtimeId: 'python-runtime-1' }),
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'My Python Session' }),
			metadata: {
				sessionId: 'console-session-1',
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
			},
		});
	}

	function makeNotebookForegroundSession(): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
				runtimeId: 'python-runtime-1',
				runtimeName: 'Python 3.12',
			}),
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'My Notebook Session' }),
			metadata: {
				sessionId: 'notebook-session-1',
				sessionMode: LanguageRuntimeSessionMode.Notebook,
				notebookUri: URI.file('/path/to/notebook.ipynb'),
				createdTimestamp: 0,
				startReason: 'test',
			},
		});
	}

	it('returns early without calling startNewRuntimeSession when there is no foreground session', async () => {
		foregroundSession = undefined;
		await runAction();
		expect(executeCommand).not.toHaveBeenCalled();
		expect(startNewRuntimeSession).not.toHaveBeenCalled();
	});

	it('calls startNewRuntimeSession with the foreground session runtimeId, sessionName, and sessionMode', async () => {
		foregroundSession = makeConsoleForegroundSession();
		await runAction();
		expect(executeCommand).toHaveBeenCalledWith('workbench.panel.positronConsole.focus');
		expect(startNewRuntimeSession).toHaveBeenCalledWith(
			'python-runtime-1',
			'My Python Session',
			LanguageRuntimeSessionMode.Console,
			undefined,
			'Duplicated session: My Python Session',
			RuntimeStartMode.Starting,
			true
		);
	});

	it('starts a new Console session using the notebook session runtime info when the foreground session is a notebook session', async () => {
		foregroundSession = makeNotebookForegroundSession();
		await runAction();
		expect(notifyError).not.toHaveBeenCalled();
		expect(executeCommand).toHaveBeenCalledWith('workbench.panel.positronConsole.focus');
		expect(startNewRuntimeSession).toHaveBeenCalledWith(
			'python-runtime-1',
			'Python 3.12',
			LanguageRuntimeSessionMode.Console,
			undefined,
			'Started console session from notebook session: My Notebook Session',
			RuntimeStartMode.Starting,
			true
		);
	});
});
