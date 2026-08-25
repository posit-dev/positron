/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IQuickInputService, IQuickPickItem, QuickInputHideReason, QuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimePickerContribution, IRuntimePickerItem, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeState, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestQuickPick } from '../../../../../test/vitest/testQuickPick.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { DuplicateActiveConsoleSessionAction, EvaluateCodeAction, SelectSessionAction, StartNewConsoleSessionAction, selectLanguageRuntimeSession, selectNewLanguageRuntime, summarizeRegisteredRuntime } from '../../browser/languageRuntimeActions.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IRuntimeSessionService, ILanguageRuntimeSession, RuntimeStartMode } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ActiveRuntimeSession } from '../../../../services/runtimeSession/common/activeRuntimeSession.js';
import { UiClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { EvalResult } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
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

describe('summarizeRegisteredRuntime', () => {
	test('keeps the fields an agent needs and drops the icon and extra data', () => {
		const summary = summarizeRegisteredRuntime(makeRuntime({
			runtimeId: 'python-abc',
			runtimeDisplayPath: '~/venvs/proj/bin/python',
			base64EncodedIconSvg: 'PHN2Zz4uLi48L3N2Zz4=',
			extraRuntimeData: { pythonPath: '/secret' },
		}));

		expect(summary).toEqual({
			runtimeId: 'python-abc',
			languageId: 'python',
			languageName: 'Python',
			languageVersion: '3.12.0',
			runtimeName: 'Python 3.12 (System)',
			runtimeShortName: '3.12',
			runtimeVersion: '0.0.0',
			runtimeSource: 'System',
			runtimePath: '~/venvs/proj/bin/python',
			startupBehavior: 'implicit',
			extensionId: 'test-extension',
		});
	});

	test('falls back to the raw path when there is no display path', () => {
		const summary = summarizeRegisteredRuntime(makeRuntime({ runtimePath: '/usr/bin/python3' }));
		expect(summary.runtimePath).toBe('/usr/bin/python3');
	});
});

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
			// The suggested (primary) runtime appears only under "Suggested", not
			// again under its own environment type -- so its "System" group is
			// omitted entirely since it had no other members.
			expect(shape).toMatchInlineSnapshot(`
				[
				  "[Suggested]",
				  "py-system=Python (System)",
				  "[Conda]",
				  "py-conda=Python (Conda)",
				]
			`);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('does not duplicate the suggested runtime under its environment type', async () => {
			registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));

			const promise = runPicker();
			await waitUntilOpened();
			const suggestedRuntimeItems = pick.items.filter(
				(item): item is IQuickPickItem => item.type !== 'separator' && item.id === 'py-system'
			);
			expect(suggestedRuntimeItems).toHaveLength(1);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('keeps every single-listed runtime searchable when the picker is filtered', async () => {
			// The suggested runtime now appears only under "Suggested". An item flagged
			// neverShowWhenFiltered is hidden once the user types a query, so any runtime
			// with a single listing must NOT carry that flag -- otherwise filtering would
			// hide the user's preferred interpreter entirely.
			registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));
			registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeName: 'Python (Conda)' }));

			const promise = runPicker();
			await waitUntilOpened();
			const runtimeItems = pick.items.filter(
				(item): item is IQuickPickItem => item.type !== 'separator'
			);
			expect(runtimeItems.every(item => item.neverShowWhenFiltered !== true)).toBe(true);
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		});

		it('sorts within an env type by version descending, unsupported runtimes last', async () => {
			// Register a preferred runtime first so the three runtimes under test
			// are all alternates (the primary is shown only under "Suggested").
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref', runtimeName: 'Python (preferred)' }));
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

describe('StartNewConsoleSessionAction', () => {
	const startNewRuntimeSession = vi.fn(async (): Promise<string> => 'new-session-id');
	const executeCommand = vi.fn(async () => undefined);
	let pick: TestQuickPick<IQuickPickItem>;
	let preferredByLanguage: Map<string, ILanguageRuntimeMetadata>;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ startNewRuntimeSession }))
		.stub(ICommandService, { executeCommand })
		// The picker only lists a language once it has a preferred runtime for it,
		// so registerRuntime below records each runtime as its language's preferred.
		.stub(IRuntimeStartupService, {
			getPreferredRuntime: (languageId: string) => preferredByLanguage.get(languageId),
		})
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			createQuickPick: (() => pick.asQuickPick()) as IQuickInputService['createQuickPick'],
		}))
		.build();

	beforeEach(() => {
		pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
		preferredByLanguage = new Map();
		ctx.get(ILanguageRuntimeService).setStartupPhase(RuntimeStartupPhase.Complete);
	});

	function runAction(runtimeId?: string) {
		return ctx.instantiationService.invokeFunction(accessor =>
			new StartNewConsoleSessionAction().run(accessor, runtimeId));
	}

	function registerRuntime(runtimeId: string, runtimeName: string) {
		const runtimeService = ctx.get(ILanguageRuntimeService);
		const runtime = makeRuntime({ runtimeId, runtimeName });
		ctx.disposables.add(runtimeService.registerRuntime(runtime));
		preferredByLanguage.set(runtime.languageId, runtime);
	}

	// Agent-invocable path: a runtimeId is supplied, so the command must
	// resolve it directly and skip the picker entirely.
	it('starts the session for a registered runtimeId without opening a picker', async () => {
		registerRuntime('py-1', 'Python 3.12 (System)');

		const result = await runAction('py-1');

		expect(result).toEqual({ started: true, sessionId: 'new-session-id' });
		expect(pick.show).not.toHaveBeenCalled();
		expect(executeCommand).toHaveBeenCalledWith('workbench.panel.positronConsole.focus');
		expect(startNewRuntimeSession).toHaveBeenCalledWith(
			'py-1',
			'Python 3.12 (System)',
			LanguageRuntimeSessionMode.Console,
			undefined,
			'Runtime id supplied to startNewConsoleSession command',
			RuntimeStartMode.Starting,
			true,
			{ userSelected: false }
		);
	});

	// An unresolvable runtimeId must surface a clear error rather than
	// silently falling back to the interactive picker, which would leave a
	// programmatic caller waiting on the user.
	it('throws without starting a session or opening a picker for an unknown runtimeId', async () => {
		await expect(runAction('does-not-exist')).rejects.toThrow(/does-not-exist/);
		expect(pick.show).not.toHaveBeenCalled();
		expect(startNewRuntimeSession).not.toHaveBeenCalled();
		expect(executeCommand).not.toHaveBeenCalled();
	});

	// User path: no id, so the picker opens and the chosen runtime starts.
	it('starts the runtime the user picks when no runtimeId is supplied', async () => {
		registerRuntime('r-1', 'R 4.4.1');

		const promise = runAction();
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());
		pick.accept(pick.items.find((item): item is IQuickPickItem =>
			item.type !== 'separator' && item.id === 'r-1')!);

		expect(await promise).toEqual({ started: true, sessionId: 'new-session-id' });
		expect(startNewRuntimeSession).toHaveBeenCalledWith(
			'r-1',
			'R 4.4.1',
			LanguageRuntimeSessionMode.Console,
			undefined,
			'User selected runtime',
			RuntimeStartMode.Starting,
			true,
			{ userSelected: true }
		);
	});

	// A dismissed picker must report that nothing happened rather than looking
	// like a success to a programmatic caller.
	it('reports started: false when the user dismisses the picker', async () => {
		const promise = runAction();
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());
		pick.cancel();

		expect(await promise).toEqual({
			started: false,
			message: 'No runtime was selected, so no console session was started.',
		});
		expect(startNewRuntimeSession).not.toHaveBeenCalled();
	});

	// Menu callers can forward a context object as the first argument; it
	// must be treated as "no id supplied" (picker path), not as a runtime id.
	it('opens the picker when a menu context object is forwarded as the argument', async () => {
		const menuContext = { instance: {} };
		const promise = runAction(menuContext as never);
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());

		pick.cancel();

		await expect(promise).resolves.toMatchObject({ started: false });
		expect(startNewRuntimeSession).not.toHaveBeenCalled();
	});
});

describe('SelectSessionAction', () => {
	const executeCommand = vi.fn(async () => undefined);
	const openEditor = vi.fn(async () => undefined);
	const pickFn = vi.fn(async (): Promise<QuickPickItem | undefined> => undefined);

	let foregroundSession: ILanguageRuntimeSession | undefined;
	let sessionsById: Map<string, ILanguageRuntimeSession>;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get foregroundSession() { return foregroundSession; },
			set foregroundSession(session) { foregroundSession = session; },
			get activeSessions() { return [...sessionsById.values()]; },
			getSession: (sessionId: string) => sessionsById.get(sessionId),
		}))
		.stub(ICommandService, { executeCommand })
		.stub(IEditorService, stubInterface<IEditorService>({ openEditor }))
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			// Narrow to IQuickInputService['pick'] because the field is overloaded
			// (canPickMany: true returns Promise<T[]>, canPickMany: false returns
			// Promise<T>); our single-shape stub satisfies only one overload and
			// TS rejects it without the cast.
			pick: pickFn as IQuickInputService['pick'],
		}))
		.build();

	beforeEach(() => {
		foregroundSession = undefined;
		sessionsById = new Map();
	});

	function runAction(sessionId?: string) {
		return ctx.instantiationService.invokeFunction(accessor =>
			new SelectSessionAction().run(accessor, sessionId));
	}

	function addSession(
		sessionId: string,
		overrides: { notebookUri?: URI; runtimeState?: RuntimeState } = {},
	): ILanguageRuntimeSession {
		const { notebookUri, runtimeState = RuntimeState.Idle } = overrides;
		const session = stubInterface<ILanguageRuntimeSession>({
			sessionId,
			metadata: {
				sessionId,
				sessionMode: notebookUri
					? LanguageRuntimeSessionMode.Notebook
					: LanguageRuntimeSessionMode.Console,
				notebookUri,
				createdTimestamp: 0,
				startReason: 'test',
			},
			runtimeMetadata: makeRuntime(),
			dynState: {
				sessionName: sessionId,
				currentWorkingDirectory: '',
				busy: false,
				inputPrompt: '>',
				continuationPrompt: '+',
			},
			getRuntimeState: () => runtimeState,
		});
		sessionsById.set(sessionId, session);
		return session;
	}

	// Agent-invocable path: a sessionId is supplied, so the command must
	// resolve it directly and skip the picker entirely.
	it('resolves a console sessionId directly, focuses the console, and skips the picker', async () => {
		const session = addSession('console-1');

		const result = await runAction('console-1');

		expect(result).toEqual({ selected: true, sessionId: 'console-1' });
		expect(pickFn).not.toHaveBeenCalled();
		expect(foregroundSession).toBe(session);
		expect(executeCommand).toHaveBeenCalledWith('workbench.panel.positronConsole.focus');
		expect(openEditor).not.toHaveBeenCalled();
	});

	it('resolves a notebook sessionId directly, opens its editor, and skips the picker', async () => {
		const uri = URI.file('/path/to/notebook.ipynb');
		const session = addSession('notebook-1', { notebookUri: uri });

		const result = await runAction('notebook-1');

		expect(result).toEqual({ selected: true, sessionId: 'notebook-1' });
		expect(pickFn).not.toHaveBeenCalled();
		expect(foregroundSession).toBe(session);
		expect(openEditor).toHaveBeenCalledWith({ resource: uri });
		expect(executeCommand).not.toHaveBeenCalled();
	});

	// An unresolvable sessionId must surface a clear error rather than
	// silently falling back to the interactive picker, which would leave a
	// programmatic caller waiting on the user.
	it('throws without changing the foreground session or opening a picker for an unknown sessionId', async () => {
		await expect(runAction('does-not-exist')).rejects.toThrow(/does-not-exist/);

		expect(pickFn).not.toHaveBeenCalled();
		expect(foregroundSession).toBeUndefined();
		expect(executeCommand).not.toHaveBeenCalled();
		expect(openEditor).not.toHaveBeenCalled();
	});

	// The picker leaves exited sessions out, so selecting one by id must fail
	// too rather than making a dead session the foreground session.
	it('throws for a session that has exited', async () => {
		addSession('exited-1', { runtimeState: RuntimeState.Exited });

		await expect(runAction('exited-1')).rejects.toThrow(/has exited/);
		expect(foregroundSession).toBeUndefined();
	});

	// User path: no id, so the picker opens and the chosen session is applied.
	it('applies the session the user picks when sessionId is omitted', async () => {
		const session = addSession('console-1');
		pickFn.mockResolvedValueOnce({ id: 'console-1', label: 'console-1' });

		const result = await runAction();

		expect(result).toEqual({ selected: true, sessionId: 'console-1' });
		expect(pickFn).toHaveBeenCalled();
		expect(foregroundSession).toBe(session);
		expect(executeCommand).toHaveBeenCalledWith('workbench.panel.positronConsole.focus');
	});

	// A dismissed picker must report that nothing happened rather than looking
	// like a success to a programmatic caller.
	it('reports selected: false when the user dismisses the picker', async () => {
		const result = await runAction();

		expect(result).toEqual({
			selected: false,
			message: 'No session was selected, so the active session is unchanged.',
		});
		expect(pickFn).toHaveBeenCalled();
		expect(foregroundSession).toBeUndefined();
	});

	// Menu callers can forward a context object as the first argument; it
	// must be treated as "no id supplied" (picker path), not as a session id.
	it('opens the picker when a menu context object is forwarded as the argument', async () => {
		const menuContext = { instance: {} };
		const result = await runAction(menuContext as never);

		expect(result).toMatchObject({ selected: false });
		expect(pickFn).toHaveBeenCalled();
		expect(foregroundSession).toBeUndefined();
	});
});

describe('EvaluateCodeAction', () => {
	const openEditor = vi.fn(async () => undefined);
	const warn = vi.fn();
	const evaluateCode = vi.fn(async (): Promise<EvalResult> => ({ result: { a: 1 }, output: '' }));
	const inputFn = vi.fn(async (): Promise<string | undefined> => '{"a": 1}');

	let foregroundSession: ILanguageRuntimeSession | undefined;
	let activeSession: ActiveRuntimeSession | undefined;
	// Set by ensureUiClient, mirroring how ActiveRuntimeSession only assigns
	// `uiClient` once the comm round-trip to the kernel resolves.
	let uiClient: UiClientInstance | undefined;
	let ensureUiClientFails: boolean;

	const ctx = createTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			get foregroundSession() { return foregroundSession; },
			getActiveSession: () => activeSession,
		}))
		.stub(INotificationService, stubInterface<INotificationService>({ warn }))
		.stub(IEditorService, stubInterface<IEditorService>({ openEditor }))
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			input: inputFn,
		}))
		.stub(IProgressService, stubInterface<IProgressService>({
			// Cast: withProgress is generic over its options and progress shapes.
			withProgress: ((_options: unknown, task: () => Promise<unknown>) =>
				task()) as IProgressService['withProgress'],
		}))
		.build();

	const ensureUiClient = vi.fn(async () => {
		// Resolve on a later turn, so a caller that reads `uiClient` without
		// awaiting sees the pre-comm state.
		await new Promise(resolve => setTimeout(resolve, 0));
		if (ensureUiClientFails) {
			throw new Error('comm_open failed');
		}
		uiClient = readyUiClient();
		return 'ui-client-1';
	});

	function readyUiClient(): UiClientInstance {
		return stubInterface<UiClientInstance>({ evaluateCode });
	}

	beforeEach(() => {
		uiClient = undefined;
		ensureUiClientFails = false;
		foregroundSession = stubInterface<ILanguageRuntimeSession>({
			sessionId: 'python-session-1',
			runtimeMetadata: makeRuntime(),
		});
		activeSession = stubInterface<ActiveRuntimeSession>({
			get uiClient() { return uiClient; },
			ensureUiClient,
		});
	});

	function runAction() {
		return ctx.instantiationService.invokeFunction(accessor =>
			new EvaluateCodeAction().run(accessor));
	}

	// `openEditor` is stubbed zero-arg to satisfy IEditorService's overloads, which
	// leaves its recorded args untyped; narrow them back to what the action passes.
	function openedEditor(): IUntitledTextResourceEditorInput {
		const args: unknown[] = openEditor.mock.calls[0];
		return args[0] as IUntitledTextResourceEditorInput;
	}

	it('waits for the UI comm on a session whose comm is still starting', async () => {
		await runAction();

		expect(warn).not.toHaveBeenCalled();
		expect(ensureUiClient).toHaveBeenCalled();
		expect(openedEditor()).toMatchObject({
			languageId: 'markdown',
			contents: expect.stringContaining('## Result'),
		});
	});

	it('evaluates immediately when the UI comm is already up', async () => {
		uiClient = readyUiClient();

		await runAction();

		expect(warn).not.toHaveBeenCalled();
		expect(evaluateCode).toHaveBeenCalledWith('{"a": 1}');
		expect(openEditor).toHaveBeenCalled();
	});

	it('warns when the UI comm cannot be started', async () => {
		ensureUiClientFails = true;

		await runAction();

		expect(warn).toHaveBeenCalledWith('Session does not support code evaluation.');
		expect(inputFn).not.toHaveBeenCalled();
		expect(openEditor).not.toHaveBeenCalled();
	});

	it('warns when the session has no active session wrapper', async () => {
		activeSession = undefined;

		await runAction();

		expect(warn).toHaveBeenCalledWith('Session does not support code evaluation.');
		expect(inputFn).not.toHaveBeenCalled();
	});

	it('opens no editor when the user dismisses the code prompt', async () => {
		inputFn.mockResolvedValueOnce(undefined);

		await runAction();

		expect(warn).not.toHaveBeenCalled();
		expect(evaluateCode).not.toHaveBeenCalled();
		expect(openEditor).not.toHaveBeenCalled();
	});
});
