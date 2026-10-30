/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IPickOptions, IQuickInputService, IQuickPickItem, QuickInputButtonLocation, QuickInputHideReason, QuickPickItem } from '../../../../../platform/quickinput/common/quickInput.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, IRuntimePickerContribution, IRuntimePickerItem, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeState, RuntimeStartupPhase } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeStartupService, PreferredRuntimeReason } from '../../../../services/runtimeStartup/common/runtimeStartupService.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { TestQuickPick } from '../../../../../test/vitest/testQuickPick.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { DiscoverAllRuntimesAction, DuplicateActiveConsoleSessionAction, EvaluateCodeAction, SelectSessionAction, StartNewConsoleSessionAction, selectLanguage, selectLanguageRuntimeSession, selectNewLanguageRuntime, startNewAgentSession, startNewConsoleSession, summarizeActiveSession, summarizeRegisteredRuntime } from '../../browser/languageRuntimeActions.js';
import { DeferredPromise, timeout } from '../../../../../base/common/async.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IRuntimeSessionService, ILanguageRuntimeSession, RuntimeStartMode, SessionStartReasonId } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ActiveRuntimeSession } from '../../../../services/runtimeSession/common/activeRuntimeSession.js';
import { UiClientInstance } from '../../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { EvalResult } from '../../../../services/languageRuntime/common/positronUiComm.js';
import { IProgressService } from '../../../../../platform/progress/common/progress.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { POSITRON_NOTEBOOK_EDITOR_INPUT_ID, SELECT_KERNEL_ID_POSITRON } from '../../../positronNotebook/common/positronNotebookCommon.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../../../services/runtimeSession/test/common/testRuntimeSessionService.js';
import { waitForRuntimeState } from '../../../../services/runtimeSession/test/common/testLanguageRuntimeSession.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { LANGUAGE_ORDER_KEY } from '../../../../services/languageRuntime/common/languageOrder.js';
import { AGENT_SESSIONS_ENABLED_KEY } from '../../../positronAssistant/common/positronAIConfigurationKeys.js';

function setLanguageOrder(configurationService: IConfigurationService, order: string[]): void {
	(configurationService as TestConfigurationService).setUserConfiguration(LANGUAGE_ORDER_KEY, order);
}

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
		}), true);

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
			affiliated: true,
		});
	});

	test('falls back to the raw path when there is no display path', () => {
		const summary = summarizeRegisteredRuntime(makeRuntime({ runtimePath: '/usr/bin/python3' }), false);
		expect(summary.runtimePath).toBe('/usr/bin/python3');
	});
});

describe('summarizeActiveSession', () => {
	function makeSession(sessionId: string, sessionName: string, runtimeId: string): ILanguageRuntimeSession {
		return stubInterface<ILanguageRuntimeSession>({
			sessionId,
			runtimeMetadata: makeRuntime({ runtimeId }),
			dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName }),
			metadata: {
				sessionId,
				sessionMode: LanguageRuntimeSessionMode.Console,
				notebookUri: undefined,
				createdTimestamp: 0,
				startReason: 'test',
				owner: 'user',
			},
			getRuntimeState: () => RuntimeState.Idle,
		});
	}

	test('projects the fields an agent needs and flags only the foreground session', () => {
		const sessions = [
			makeSession('py-session-1', 'Python 3.12', 'py-abc'),
			makeSession('py-session-2', 'Python 3.12 (2)', 'py-abc'),
		];

		const summaries = sessions.map(session => summarizeActiveSession(session, 'py-session-1'));

		expect(summaries).toMatchInlineSnapshot(`
			[
			  {
			    "foreground": true,
			    "languageId": "python",
			    "languageName": "Python",
			    "runtimeId": "py-abc",
			    "runtimeName": "Python 3.12 (System)",
			    "sessionId": "py-session-1",
			    "sessionMode": "console",
			    "sessionName": "Python 3.12",
			    "state": "idle",
			  },
			  {
			    "foreground": false,
			    "languageId": "python",
			    "languageName": "Python",
			    "runtimeId": "py-abc",
			    "runtimeName": "Python 3.12 (System)",
			    "sessionId": "py-session-2",
			    "sessionMode": "console",
			    "sessionName": "Python 3.12 (2)",
			    "state": "idle",
			  },
			]
		`);
	});
});

describe('selectNewLanguageRuntime', () => {
	let preferredByLanguage: Map<string, ILanguageRuntimeMetadata>;
	let preferredReason: PreferredRuntimeReason;
	let preferredRecommendationReason: string | undefined;
	// `pick` is reassigned in beforeEach (and once mid-test in the title fallback
	// case). The IQuickInputService stub captures it by closure so each
	// createQuickPick() call returns whichever double is current.
	let pick: TestQuickPick<IQuickPickItem>;

	// Stubbed at describe scope so vi.spyOn can attach in individual tests.
	const rediscoverAllRuntimes = vi.fn(async (_quiet?: boolean) => undefined);

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, {
			getPreferredRuntimeWithReason: (langId: string) => {
				const runtime = preferredByLanguage.get(langId);
				return runtime
					? { runtime, reason: preferredReason, recommendationReason: preferredRecommendationReason }
					: undefined;
			},
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
		preferredReason = PreferredRuntimeReason.Fallback;
		preferredRecommendationReason = undefined;
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

	type PickerOptions = Parameters<typeof selectNewLanguageRuntime>[1];

	/** Opens the picker, runs `body`, then cancels the picker even when `body` fails. */
	async function withOpenPicker(...args: [body: () => unknown] | [options: PickerOptions, body: () => unknown]): Promise<void> {
		const [options, body] = args.length === 1 ? [undefined, args[0]] : args;
		const promise = runPicker(options);
		try {
			await waitUntilOpened();
			await body();
		} finally {
			pick.cancel(QuickInputHideReason.Gesture);
			await promise;
		}
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

	/** The separator labels of the built picker, which are the environment type headings. */
	function separatorLabels(): string[] {
		return pick.items.filter(item => item.type === 'separator').map(item => item.label ?? '');
	}

	/** The ids of the runtime rows, in picker order. */
	function rowIds(): (string | undefined)[] {
		return pick.items
			.filter((item): item is IQuickPickItem => item.type !== 'separator')
			.map(item => item.id);
	}

	/** The picker shape: headers in brackets (`[---]` for a divider with no label), rows by id. */
	function shape(): string[] {
		return pick.items.map(item => item.type === 'separator' ? `[${item.label ?? '---'}]` : `${item.id}`);
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

	/**
	 * Registers a picker contribution for `languageId`. Its items resolve at
	 * once, or, with `later`, when the returned function is called.
	 */
	function contribute(handle: number, languageId: string, items: IRuntimePickerItem[], later = false): () => void {
		let release = () => { };
		const ready = later ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
		const contribution: IRuntimePickerContribution = {
			handle,
			languageId,
			getItems: vi.fn(async () => {
				await ready;
				return items;
			}),
			onSelect: vi.fn(),
		};
		ctx.disposables.add(ctx.get(ILanguageRuntimeService).registerPickerContribution(contribution));
		return () => release();
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

			await withOpenPicker({ languageId: 'python' }, async () => {
				const ids = pick.items
					.filter((item): item is IQuickPickItem => item.type !== 'separator')
					.map(item => item.id);
				expect(ids).toContain('py-1');
				expect(ids).not.toContain('r-1');
			});
		});

		it('passes languageId through to getPickerContributions', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const spy = vi.spyOn(ctx.get(ILanguageRuntimeService), 'getPickerContributions');
			await withOpenPicker({ languageId: 'python' }, async () => {
				expect(spy).toHaveBeenCalledWith('python');
			});
		});
	});

	describe('options.currentRuntimeId', () => {
		it('pre-focuses the matching item via activeItems', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0', runtimeName: 'Python 3.10' }));

			await withOpenPicker({ currentRuntimeId: 'py-2' }, async () => {
				expect(pick.activeItems).toHaveLength(1);
				expect(pick.activeItems[0].id).toBe('py-2');
			});
		});

		it('falls back to the first row when no item matches the id', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await withOpenPicker({ currentRuntimeId: 'unknown-id' }, async () => {
				await vi.waitFor(() => expect(pick.activeItems[0]?.id).toBe('py-1'));
			});
		});
	});

	describe('item structure', () => {
		beforeEach(() => {
			setLanguageOrder(ctx.get(IConfigurationService), []);
		});

		/** The R and Python runtime labels, in picker order. */
		function runtimeLabels(): string[] {
			return pick.items.filter(item => item.type !== 'separator').map(item => item.label).filter(label => label === 'R 4.4' || label === 'Python 3.12');
		}

		it('lists languages in the configured order', async () => {
			setLanguageOrder(ctx.get(IConfigurationService), ['r']);
			await registerRuntime(makeRuntime({ runtimeId: 'py', languageId: 'python', languageName: 'Python', runtimeName: 'Python 3.12' }));
			await registerRuntime(makeRuntime({ runtimeId: 'r', languageId: 'r', languageName: 'R', runtimeName: 'R 4.4' }));
			await withOpenPicker(async () => {
				expect(runtimeLabels()).toEqual(['R 4.4', 'Python 3.12']);
			});
		});

		it('keeps alphabetical order when the setting is unset', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'r', languageId: 'r', languageName: 'R', runtimeName: 'R 4.4' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py', languageId: 'python', languageName: 'Python', runtimeName: 'Python 3.12' }));
			await withOpenPicker(async () => {
				expect(runtimeLabels()).toEqual(['Python 3.12', 'R 4.4']);
			});
		});

		it('groups Suggested + per-environment-type runtimes with separators', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeName: 'Python (Conda)' }));

			await withOpenPicker(async () => {
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
			});
		});

		it('does not duplicate the suggested runtime under its environment type', async () => {
			registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));

			await withOpenPicker(async () => {
				const suggestedRuntimeItems = pick.items.filter(
					(item): item is IQuickPickItem => item.type !== 'separator' && item.id === 'py-system'
				);
				expect(suggestedRuntimeItems).toHaveLength(1);
			});
		});

		it('keeps every single-listed runtime searchable when the picker is filtered', async () => {
			// The suggested runtime now appears only under "Suggested". An item flagged
			// neverShowWhenFiltered is hidden once the user types a query, so any runtime
			// with a single listing must NOT carry that flag -- otherwise filtering would
			// hide the user's preferred interpreter entirely.
			registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeName: 'Python (System)' }));
			registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeName: 'Python (Conda)' }));

			await withOpenPicker(async () => {
				const runtimeItems = pick.items.filter(
					(item): item is IQuickPickItem => item.type !== 'separator'
				);
				expect(runtimeItems.every(item => item.neverShowWhenFiltered !== true)).toBe(true);
			});
		});

		it('searches interpreter paths as well as names', async () => {
			await registerRuntime(makeRuntime({
				runtimeId: 'py-opt',
				runtimeName: 'Python 3.12',
				runtimePath: '/opt/python/bin/python3',
			}));

			await withOpenPicker(async () => {
				const item = pick.items.find(
					(item): item is IQuickPickItem => item.type !== 'separator' && item.id === 'py-opt'
				);
				expect(item?.detail).toBe('/opt/python/bin/python3');
				expect(pick.matchOnDetail).toBe(true);
			});
		});

		it('orders the environment type headings by runtimeSourceOrder, not registration order', async () => {
			// Registration order is discovery order, which varies run to run, so the
			// extension ranks its sources instead and the picker sorts by that rank.
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref', runtimeSource: 'Pyenv' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-system', runtimeSource: 'System', runtimeSourceOrder: 30 }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeSourceOrder: 20 }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-uv', runtimeSource: 'uv', runtimeSourceOrder: 10 }));

			await withOpenPicker(async () => {
				expect(separatorLabels()).toEqual(['Suggested', 'uv', 'Conda', 'System']);
			});
		});

		it('lists unranked environment types after ranked ones, in registration order', async () => {
			// Registered Other before Mystery on purpose: that order is the reverse of
			// alphabetical, so the assertion can only pass if the unranked sources kept
			// their registration order rather than being sorted by label.
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref', runtimeSource: 'Pyenv' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-other', runtimeSource: 'Other' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-mystery', runtimeSource: 'Mystery' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-conda', runtimeSource: 'Conda', runtimeSourceOrder: 20 }));

			await withOpenPicker(async () => {
				expect(separatorLabels()).toEqual(['Suggested', 'Conda', 'Other', 'Mystery']);
			});
		});

		it('ranks a source by its best-ranked runtime when only some carry a rank', async () => {
			// An extension can rank some of a source's runtimes and not others, and they
			// register in no guaranteed order. The source must follow the rank it does
			// have rather than whichever runtime happened to be registered last.
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref', runtimeSource: 'Pyenv' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-sys-fresh', runtimeSource: 'System', runtimeSourceOrder: 30 }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-sys-cached', runtimeSource: 'System' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-global', runtimeSource: 'Global', runtimeSourceOrder: 40 }));

			await withOpenPicker(async () => {
				expect(separatorLabels()).toEqual(['Suggested', 'System', 'Global']);
			});
		});

		it('sorts within an env type by version descending, unsupported runtimes last', async () => {
			// Register a preferred runtime first so the runtimes under test
			// are all alternates (the primary is shown only under "Suggested").
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref', runtimeName: 'Python (preferred)' }));
			await registerRuntime(makeRuntime({
				runtimeId: 'py-older', languageVersion: '3.7.0', runtimeName: 'Python 3.7 (unsupported)',
				extraRuntimeData: { supported: false },
			}));
			await registerRuntime(makeRuntime({ runtimeId: 'py-310', languageVersion: '3.10.0', runtimeName: 'Python 3.10' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-312', languageVersion: '3.12.0', runtimeName: 'Python 3.12' }));
			await registerRuntime(makeRuntime({
				runtimeId: 'py-old', languageVersion: '3.8.0', runtimeName: 'Python 3.8 (unsupported)',
				extraRuntimeData: { supported: false },
			}));

			await withOpenPicker(async () => {
				// Find the System group (everything is runtimeSource: 'System' here) and read the order after the separator.
				const items = pick.items;
				const systemIdx = items.findIndex(i => i.type === 'separator' && i.label === 'System');
				const groupIds = items.slice(systemIdx + 1)
					.filter((item): item is IQuickPickItem => item.type !== 'separator')
					.map(item => item.id);
				expect(groupIds).toEqual(['py-312', 'py-310', 'py-old', 'py-older']);
			});
		});

		it('uses picker.group and groupOrder for headings', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-global', picker: { group: 'Global environments', groupOrder: 1, label: 'Python 3.11.0' } }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-proj', picker: { group: 'Project environments', groupOrder: 0, label: 'Python 3.12.0' } }));

			await withOpenPicker(async () => {
				expect(separatorLabels()).toEqual(['Suggested', 'Project environments', 'Global environments']);
			});
		});

		it('uses picker.label and picker.description on rows', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-uv', runtimePath: '/opt/uv/bin/python', picker: { group: 'Project environments', groupOrder: 0, label: 'Python 3.12.4', description: 'uv: myproject' } }));

			await withOpenPicker(async () => {
				const item = pickItemById('py-uv');
				expect({ label: item?.label, description: item?.description, detail: item?.detail }).toEqual({
					label: 'Python 3.12.4',
					description: 'uv: myproject',
					detail: '/opt/uv/bin/python',
				});
			});
		});

		it.each([
			{ reason: PreferredRuntimeReason.RunningConsole, text: 'running' },
			{ reason: PreferredRuntimeReason.WorkspaceAffiliation, text: 'last used in this workspace' },
			{ reason: PreferredRuntimeReason.RecentlyStarted, text: 'started recently' },
		])('shows the reason on the Suggested row ($text)', async ({ reason, text }) => {
			preferredReason = reason;
			await registerRuntime(makeRuntime({ runtimeId: 'py-uv', picker: { group: 'Project environments', groupOrder: 0, label: 'Python 3.12.4', description: 'uv: myproject' } }));

			await withOpenPicker(async () => {
				expect(pickItemById('py-uv')?.description).toBe(`uv: myproject \u00B7 ${text}`);
			});
		});

		it('shows the reason alone on a Suggested row with no gray text', async () => {
			preferredReason = PreferredRuntimeReason.RunningConsole;
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));

			await withOpenPicker(async () => {
				expect(pickItemById('py-1')?.description).toBe('running');
			});
		});

		it.each([
			{ recommendationReason: 'project environment', expected: 'uv: myproject \u00B7 project environment' },
			{ recommendationReason: undefined, expected: 'uv: myproject \u00B7 recommended' },
		])('shows the extension reason for a recommendation ($recommendationReason)', async ({ recommendationReason, expected }) => {
			preferredReason = PreferredRuntimeReason.Recommended;
			preferredRecommendationReason = recommendationReason;
			await registerRuntime(makeRuntime({ runtimeId: 'py-uv', picker: { group: 'Project environments', groupOrder: 0, label: 'Python 3.12.4', description: 'uv: myproject' } }));

			await withOpenPicker(async () => {
				expect(pickItemById('py-uv')?.description).toBe(expected);
			});
		});

		it('shows no reason for the fallback rule', async () => {
			preferredReason = PreferredRuntimeReason.Fallback;
			await registerRuntime(makeRuntime({ runtimeId: 'py-uv', picker: { group: 'Project environments', groupOrder: 0, label: 'Python 3.12.4', description: 'uv: myproject' } }));

			await withOpenPicker(async () => {
				expect(pickItemById('py-uv')?.description).toBe('uv: myproject');
			});
		});

		it('sorts rows by rowOrder, then version descending, then label', async () => {
			const group = { group: 'Project environments', groupOrder: 0 };
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-313', languageVersion: '3.13.0', picker: { ...group, rowOrder: 1, label: 'Python 3.13.0' } }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-311', languageVersion: '3.11.2', picker: { ...group, rowOrder: 0, label: 'Python 3.11.2' } }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-312', languageVersion: '3.12.1', picker: { ...group, rowOrder: 0, label: 'Python 3.12.1' } }));

			await withOpenPicker(async () => {
				expect(rowIds().filter(id => id !== 'py-pref')).toEqual(['py-312', 'py-311', 'py-313']);
			});
		});

		it('keeps runtimeName and the runtimeSource header for a runtime without picker info', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-legacy', runtimeSource: 'Conda', runtimeName: 'Python (legacy)' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-new', picker: { group: 'Global environments', groupOrder: 1, label: 'Python 3.12.0' } }));

			await withOpenPicker(async () => {
				expect(separatorLabels()).toEqual(['Suggested', 'Global environments', 'Conda']);
				expect(pickItemById('py-legacy')?.label).toBe('Python (legacy)');
				expect(pickItemById('py-new')?.label).toBe('Python 3.12.0');
			});
		});

		it('matches on the gray text', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await withOpenPicker(async () => {
				expect(pick.matchOnDescription).toBe(true);
			});
		});

		it('keeps the picker order when searching', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await withOpenPicker(async () => {
				expect(pick.sortByLabel).toBe(false);
			});
		});
	});

	describe('language filters', () => {
		const python = { languageId: 'python', languageName: 'Python' };
		const r = { languageId: 'r', languageName: 'R' };

		beforeEach(() => {
			setLanguageOrder(ctx.get(IConfigurationService), []);
		});

		/** Clicks the filter button whose tooltip names `languageName`. */
		function clickFilter(languageName: string): void {
			const button = pick.buttons.find(b => b.tooltip === `Show only ${languageName}`);
			expect(button).toBeDefined();
			pick.triggerButton(button!);
		}

		it('adds Python and R toggles in language order', async () => {
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await withOpenPicker(async () => {
				expect(pick.buttons).toEqual([
					{ iconClass: 'positron-picker-filter positron-picker-filter-python', tooltip: 'Show only Python', toggle: { checked: false }, location: QuickInputButtonLocation.Input, alwaysVisible: true },
					{ iconClass: 'positron-picker-filter positron-picker-filter-r', tooltip: 'Show only R', toggle: { checked: false }, location: QuickInputButtonLocation.Input, alwaysVisible: true },
				]);
			});
		});

		it('adds no toggles when options.languageId is set', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker({ languageId: 'python' }, async () => {
				expect(pick.buttons).toEqual([]);
			});
		});

		it('adds no toggles when only one filterable language has runtimes', async () => {
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-2' }));
			await withOpenPicker(async () => {
				expect(pick.buttons).toEqual([]);
			});
		});

		// Filters narrow a list of interpreters; a setup item alone is not one to narrow.
		it('adds no toggles when the other language has only a setup item', async () => {
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			contribute(1, 'python', [{ id: 'install', label: 'Install Python via uv', suggested: true }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Install Python via uv');
				expect(pick.buttons).toEqual([]);
			});
		});

		it('shows only the chosen language, under Suggested, when a toggle is on', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1', runtimeSource: 'System' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', runtimeSource: 'Conda' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker(async () => {
				clickFilter('Python');
				expect(shape()).toEqual(['[Suggested]', 'py-1', '[Conda]', 'py-2']);
			});
		});

		it('turns the other toggle off', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker(async () => {
				clickFilter('Python');
				clickFilter('R');
				expect(pick.buttons.map(b => b.toggle?.checked)).toEqual([false, true]);
				expect(rowIds()).toEqual(['r-1']);

				clickFilter('R');
				expect(pick.buttons.map(b => b.toggle?.checked)).toEqual([false, false]);
				expect(shape()).toEqual(['[Suggested]', 'py-1', 'r-1']);
			});
		});

		it('keeps the suggested runtime in Suggested, with its reason, when a filter is on', async () => {
			preferredReason = PreferredRuntimeReason.RunningConsole;
			const projectGroup = { group: 'Project environments', groupOrder: 0 };
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-uv', languageVersion: '3.11.0', picker: { ...projectGroup, label: 'Python 3.11.0', description: 'uv: myproject' } }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-venv', languageVersion: '3.13.0', picker: { ...projectGroup, label: 'Python 3.13.0' } }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker(async () => {
				clickFilter('Python');
				expect(shape()).toEqual(['[Suggested]', 'py-uv', '[Project environments]', 'py-venv']);
				expect(pickItemById('py-uv')?.description).toBe('uv: myproject \u00B7 running');
			});
		});

		it('keeps Suggested while the search box has text', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1', runtimeSource: 'System' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', runtimeSource: 'Conda' }));
			await withOpenPicker(async () => {
				pick.typeValue('py');
				expect(shape()).toEqual(['[Suggested]', 'py-1', '[Conda]', 'py-2']);
			});
		});


		it('hides Python contributed items when the R filter is on', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			contribute(1, 'python', [{ id: 'setup', label: 'Install Python via uv' }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Install Python via uv');
				clickFilter('R');
				expect(pickItemByLabel('Install Python via uv')).toBeUndefined();
				clickFilter('R');
				expect(pickItemByLabel('Install Python via uv')).toBeDefined();
			});
		});

		it('lists a suggested contributed item first in Suggested', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			contribute(1, 'python', [{ id: 'setup', label: 'Create Python Environment', separatorLabel: 'Create Environment', suggested: true }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Create Python Environment');
				expect(shape().slice(0, 3)).toEqual(['[Suggested]', '__contributed__1_setup', 'py-1']);
				expect(separatorLabels()).not.toContain('Create Environment');
			});
		});

		it('shows a contributed item\'s leading icon in the icon column, not in its label', async () => {
			contribute(1, 'python', [{ id: 'setup', label: '$(add) Create Python Environment' }]);
			await withOpenPicker(async () => {
				const item = await waitForItemByLabel('Create Python Environment');
				expect({ label: item.label, iconClass: item.iconClass }).toEqual({ label: 'Create Python Environment', iconClass: 'codicon codicon-add positron-picker-action-icon' });
			});
		});

		it('divides a contributed item with a separator label from the rows above, without the label', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			contribute(1, 'python', [{ id: 'setup', label: 'Create Python Environment', separatorLabel: 'Create Environment' }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Create Python Environment');
				expect(shape().slice(-2)).toEqual(['[---]', '__contributed__1_setup']);
			});
		});

		it('orders Suggested by the language order, with a language\'s setup item before its interpreter', async () => {
			setLanguageOrder(ctx.get(IConfigurationService), ['r']);
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			contribute(1, 'python', [{ id: 'setup', label: 'Create Python Environment', suggested: true }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Create Python Environment');
				expect(shape().slice(0, 4)).toEqual(['[Suggested]', 'r-1', '__contributed__1_setup', 'py-1']);
			});
		});

		it('orders a suggested setup item for a language with no interpreters by the language order', async () => {
			setLanguageOrder(ctx.get(IConfigurationService), ['r']);
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			contribute(1, 'python', [{ id: 'install', label: 'Install Python via uv', suggested: true }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Install Python via uv');
				expect(shape().slice(0, 3)).toEqual(['[Suggested]', 'r-1', '__contributed__1_install']);
			});
		});

		it('keeps a suggested contributed item first in Suggested when a filter is on', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1', runtimeSource: 'System' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			contribute(1, 'python', [{ id: 'setup', label: 'Create Python Environment', suggested: true }]);
			await withOpenPicker(async () => {
				await waitForItemByLabel('Create Python Environment');
				clickFilter('Python');
				expect(shape()).toEqual(['[Suggested]', '__contributed__1_setup', 'py-1']);
			});
		});

		it('shows the R header under Suggested when the R filter is on', async () => {
			const rGroup = { group: 'R', groupOrder: 0 };
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1', languageVersion: '4.4.0', picker: { ...rGroup, label: 'R 4.4.0' } }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-2', languageVersion: '4.3.0', picker: { ...rGroup, label: 'R 4.3.0' } }));
			await withOpenPicker(async () => {
				clickFilter('R');
				expect(shape()).toEqual(['[Suggested]', 'r-1', '[R]', 'r-2']);
			});
		});

		it('lists currentRuntimeId once with a filter and search text', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker({ currentRuntimeId: 'py-2' }, async () => {
				clickFilter('Python');
				pick.typeValue('py');
				expect(rowIds().filter(id => id === 'py-2')).toHaveLength(1);
				expect(rowIds().filter(id => id === 'py-pref')).toHaveLength(1);
			});
		});

		it('refocuses currentRuntimeId when a filter that hid it is turned off', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker({ currentRuntimeId: 'py-2' }, async () => {
				clickFilter('R');
				clickFilter('R');
				expect(pick.activeItems[0]?.id).toBe('py-2');
				// Still kept, so a later rebuild does not move it.
				await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-3', languageVersion: '3.11.0' }));
				expect(pick.activeItems[0]?.id).toBe('py-2');
			});
		});

		it('refocuses the row the user moved to when a filter that hid it is turned off', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker(async () => {
				pick.moveFocus(pickItemById('py-2')!);
				clickFilter('R');
				clickFilter('R');
				expect(pick.activeItems[0]?.id).toBe('py-2');
			});
		});

		it('keeps the row the user moved to while a filter was on', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-pref' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-2', languageVersion: '4.3.0' }));
			await withOpenPicker({ currentRuntimeId: 'py-pref' }, async () => {
				clickFilter('R');
				pick.moveFocus(pickItemById('r-2')!);
				clickFilter('R');
				expect(pick.activeItems[0]?.id).toBe('r-2');
			});
		});

		it('leaves focus to the search when a filter is toggled while searching', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-pref', languageVersion: '3.12.0' }));
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1', languageVersion: '4.4.0' }));
			await withOpenPicker({ currentRuntimeId: 'py-2' }, async () => {
				pick.typeValue('3.1');
				clickFilter('Python');
				// The quick pick's filtering focuses the first match, not currentRuntimeId.
				expect(pick.activeItems[0]?.id).toBe('py-pref');
			});
		});

		it('moves focus back to the search box after a filter is clicked', async () => {
			await registerRuntime(makeRuntime({ ...python, runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ ...r, runtimeId: 'r-1' }));
			await withOpenPicker(async () => {
				clickFilter('R');
				expect(pick.focusOnInput).toHaveBeenCalledOnce();
			});
		});
	});

	describe('reactive rebuild', () => {
		it('rebuilds when onDidRegisterRuntime fires mid-pick', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await withOpenPicker(async () => {
				expect(pickItemById('py-1')).toBeDefined();
				expect(pickItemById('py-2')).toBeUndefined();

				await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
				expect(pickItemById('py-2')).toBeDefined();
			});
		});

		it('rebuilds when onDidUnregisterRuntime fires mid-pick', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await withOpenPicker(async () => {
				expect(pickItemById('py-1')).toBeDefined();
				expect(pickItemById('py-2')).toBeDefined();

				// De-duplication collapsing an alias retracts a runtime while the
				// picker is open; the removed runtime must drop out of the rebuilt list.
				ctx.get(ILanguageRuntimeService).unregisterRuntime('py-2');
				expect(pickItemById('py-2')).toBeUndefined();
				expect(pickItemById('py-1')).toBeDefined();
			});
		});

		it('preserves the previously focused item across rebuilds', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			await withOpenPicker({ currentRuntimeId: 'py-2' }, async () => {
				expect(pick.activeItems[0].id).toBe('py-2');

				await registerRuntime(makeRuntime({ runtimeId: 'py-3', languageVersion: '3.13.0' }));
				expect(pick.activeItems[0].id).toBe('py-2');
			});
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

			await withOpenPicker(async () => {
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
			});
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

			await withOpenPicker(async () => {
				expect(contribution.getItems).not.toHaveBeenCalled();
			});
		});

		it('shows a busy spinner and discovering placeholder while phase is not Complete', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));

			await withOpenPicker(async () => {
				expect(pick.busy).toBe(true);
				expect(pick.placeholder).toBe('Discovering interpreters...');

				runtimeService.setStartupPhase(RuntimeStartupPhase.Complete);
				// The Complete handler is async (re-fetches contributions); poll for busy to clear.
				await vi.waitFor(() => expect(pick.busy).toBe(false));
				expect(pick.placeholder).toBeUndefined();
			});
		});

		it('shows "No interpreters found" when discovery completes with no runtimes', async () => {
			// beforeEach leaves the phase at Complete; register nothing.
			await withOpenPicker(async () => {
				expect(pick.busy).toBe(false);
				expect(pick.placeholder).toBe('No interpreters found');
			});
		});

		it('does not show a spinner when discovery is already complete on open', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await withOpenPicker(async () => {
				expect(pick.busy).toBe(false);
				expect(pick.placeholder).toBeUndefined();
			});
		});

		it('toggles the spinner back on when phase leaves Complete while the picker is open', async () => {
			const runtimeService = ctx.get(ILanguageRuntimeService);
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			// beforeEach leaves the phase at Complete.
			await withOpenPicker(async () => {
				expect(pick.busy).toBe(false);

				// Phase leaving Complete (e.g. a user-triggered rediscovery) must flip
				// the spinner back on -- the regression the broadened handler fixes.
				runtimeService.setStartupPhase(RuntimeStartupPhase.Discovering);
				expect(pick.busy).toBe(true);
				expect(pick.placeholder).toBe('Discovering interpreters...');

				runtimeService.setStartupPhase(RuntimeStartupPhase.Complete);
				await vi.waitFor(() => expect(pick.busy).toBe(false));
			});
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

			await withOpenPicker(async () => {
				// A contributed item counts as a selectable row, so once it arrives the
				// empty-state placeholder must NOT appear even though there are no runtimes.
				await waitForItemByLabel('Install Python via uv');
				expect(pick.busy).toBe(false);
				expect(pick.placeholder).toBeUndefined();
			});
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

		it('focuses a suggested contributed item that arrives after the picker opens', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			const resolveItems = contribute(10, 'python', [{ id: 'setup', label: 'Create Python Environment', suggested: true }], true);
			await withOpenPicker(async () => {
				resolveItems();
				const setup = await waitForItemByLabel('Create Python Environment');
				expect(pick.activeItems[0]).toBe(setup);
			});
		});

		it('keeps the row the user moved to when contributed items arrive', async () => {
			await registerRuntime(makeRuntime({ runtimeId: 'py-1' }));
			await registerRuntime(makeRuntime({ runtimeId: 'py-2', languageVersion: '3.10.0' }));
			const resolveItems = contribute(10, 'python', [{ id: 'setup', label: 'Create Python Environment', suggested: true }], true);
			await withOpenPicker(async () => {
				pick.moveFocus(pickItemById('py-2')!);

				resolveItems();
				await waitForItemByLabel('Create Python Environment');
				expect(pick.activeItems[0]?.id).toBe('py-2');
			});
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

			await withOpenPicker(async () => {
				await waitForItemByLabel('Working option');
				expect(consoleErrorSpy).toHaveBeenCalled();
			});
		});
	});
});

describe('selectLanguage', () => {
	let pick: TestQuickPick<IQuickPickItem>;
	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			createQuickPick: (() => pick.asQuickPick()) as IQuickInputService['createQuickPick'],
		}))
		.build();

	beforeEach(() => {
		pick = ctx.disposables.add(new TestQuickPick<IQuickPickItem>());
		const runtimeService = ctx.get(ILanguageRuntimeService);
		// R first, so the default order only comes out alphabetical if it is sorted.
		ctx.disposables.add(runtimeService.registerRuntime(makeRuntime({ runtimeId: 'r', languageId: 'r', languageName: 'R' })));
		ctx.disposables.add(runtimeService.registerRuntime(makeRuntime({ runtimeId: 'py', languageId: 'python', languageName: 'Python' })));
	});

	async function promptLabels(): Promise<string[]> {
		const promise = ctx.instantiationService.invokeFunction(accessor => selectLanguage(accessor));
		await vi.waitFor(() => expect(pick.show).toHaveBeenCalled());
		const labels = pick.items.map(item => item.label ?? '');
		pick.cancel(QuickInputHideReason.Gesture);
		await promise;
		return labels;
	}

	it('lists languages alphabetically by default', async () => {
		setLanguageOrder(ctx.get(IConfigurationService), []);
		expect(await promptLabels()).toEqual(['Python', 'R']);
	});

	it('lists languages in the configured order', async () => {
		setLanguageOrder(ctx.get(IConfigurationService), ['r']);
		expect(await promptLabels()).toEqual(['R', 'Python']);
	});
});

describe('selectLanguageRuntimeSession - agent session icon', () => {
	let pickItems: QuickPickItem[] = [];
	const pickFn = vi.fn(async (items: QuickPickItem[]): Promise<QuickPickItem | undefined> => {
		pickItems = items;
		return undefined;
	});

	const agentSession = stubInterface<ILanguageRuntimeSession>({
		sessionId: 'agent-session-1',
		metadata: {
			sessionId: 'agent-session-1',
			sessionMode: LanguageRuntimeSessionMode.Console,
			notebookUri: undefined,
			createdTimestamp: 0,
			startReason: 'test',
			owner: 'agent',
		},
		runtimeMetadata: makeRuntime(),
		dynState: stubInterface<ILanguageRuntimeSession['dynState']>({ sessionName: 'Python (Agent)' }),
		getRuntimeState: () => RuntimeState.Idle,
	});

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
			foregroundSession: undefined,
			activeSessions: [agentSession],
		}))
		.stub(IModelService, { getModel: () => null })
		.stub(IQuickInputService, stubInterface<IQuickInputService>({
			pick: pickFn as IQuickInputService['pick'],
		}))
		.build();

	// The setting gates starting agent sessions, not how existing ones look.
	it('marks an agent session even while the ai.agentSessions.enabled setting is off', async () => {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(AGENT_SESSIONS_ENABLED_KEY, false);
		await ctx.instantiationService.invokeFunction(accessor => selectLanguageRuntimeSession(accessor));
		const item = pickItems.find((item): item is IQuickPickItem =>
			item.type !== 'separator' && item.id === agentSession.sessionId);
		expect(item?.iconClasses).toContain('agent-session-icon');
	});
});

describe('selectLanguageRuntimeSession - change notebook session', () => {
	const changeNotebookSessionLabel = 'Change Notebook Session...';

	let pickItems: QuickPickItem[] = [];
	let pickOptions: IPickOptions<IQuickPickItem> | undefined;
	const pickFn = vi.fn(async (items: QuickPickItem[], options?: IPickOptions<IQuickPickItem>): Promise<QuickPickItem | undefined> => {
		pickItems = items;
		pickOptions = options;
		return undefined; // user cancels by default; specific tests override
	});
	const executeCommand = vi.fn(async () => undefined);

	let foregroundSession: ILanguageRuntimeSession | undefined;
	let activeEditor: EditorInput | undefined;

	const ctx = createLightTestContainer()
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
				owner: 'user',
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
				owner: 'user',
			},
		});
	}

	function makeEditorInput(typeId: string, uri: URI): EditorInput {
		return stubInterface<EditorInput>({ typeId, resource: uri });
	}

	beforeEach(() => {
		foregroundSession = undefined;
		pickItems = [];
		pickOptions = undefined;
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

	it('searches session paths as well as names', async () => {
		await openInterpreterPicker();
		expect(pickOptions?.matchOnDetail).toBe(true);
	});

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

	const ctx = createLightTestContainer()
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
				owner: 'user',
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
				owner: 'user',
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
			{ id: SessionStartReasonId.DuplicatedConsoleSession },
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
			{ id: SessionStartReasonId.DuplicatedNotebookSession },
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

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeSessionService, stubInterface<IRuntimeSessionService>({ startNewRuntimeSession }))
		.stub(ICommandService, { executeCommand })
		// The picker only lists a language once it has a preferred runtime for it,
		// so registerRuntime below records each runtime as its language's preferred.
		.stub(IRuntimeStartupService, {
			getPreferredRuntimeWithReason: (languageId: string) => {
				const runtime = preferredByLanguage.get(languageId);
				return runtime ? { runtime, reason: PreferredRuntimeReason.Fallback } : undefined;
			},
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
			{ id: SessionStartReasonId.NewConsoleCommand },
			RuntimeStartMode.Starting,
			true,
			{ userSelected: false, owner: 'user' }
		);
	});

	it('starts a session the agent owns without taking focus when an agent runs it', async () => {
		registerRuntime('py-1', 'Python 3.12 (System)');

		await ctx.instantiationService.invokeFunction(accessor =>
			startNewConsoleSession(accessor, 'py-1', 'agent', false));

		expect(executeCommand).not.toHaveBeenCalled();

		expect(startNewRuntimeSession).toHaveBeenCalledWith(
			'py-1',
			'Python 3.12 (System)',
			LanguageRuntimeSessionMode.Console,
			undefined,
			{ id: SessionStartReasonId.ExtensionStartedAgentSession },
			RuntimeStartMode.Starting,
			true,
			{ userSelected: false, owner: 'agent' }
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
			{ id: SessionStartReasonId.UserSelectedRuntime },
			RuntimeStartMode.Starting,
			true,
			{ userSelected: true, owner: 'user' }
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

describe('startNewAgentSession', () => {
	const ctx = createLightTestContainer().withRuntimeServices().build();

	async function startAgentSessionBesideUserSession() {
		const runtimeSessionService = ctx.get(IRuntimeSessionService);
		const userSession = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
		await waitForRuntimeState(userSession, RuntimeState.Ready);
		expect(runtimeSessionService.foregroundSession).toBe(userSession);

		const runtime = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const sessionId = await startNewAgentSession(runtimeSessionService, runtime);
		const session = runtimeSessionService.getSession(sessionId)!;
		ctx.disposables.add(session);
		await waitForRuntimeState(session, RuntimeState.Ready);

		return {
			runtime,
			userSessionId: userSession.sessionId,
			sessionId,
			summary: {
				runtimeId: session.runtimeMetadata.runtimeId,
				sessionName: session.dynState.sessionName,
				sessionMode: session.metadata.sessionMode,
				owner: session.metadata.owner,
				startReasonId: session.metadata.startReasonId,
				foregroundSessionId: runtimeSessionService.foregroundSession?.sessionId,
			},
		};
	}

	it('starts the runtime as an agent-owned console session that takes the foreground', async () => {
		const { runtime, sessionId, summary } = await startAgentSessionBesideUserSession();

		expect(summary).toEqual({
			runtimeId: runtime.runtimeId,
			sessionName: runtime.runtimeName,
			sessionMode: LanguageRuntimeSessionMode.Console,
			owner: 'agent',
			startReasonId: SessionStartReasonId.UserStartedAgentSession,
			foregroundSessionId: sessionId,
		});
	});
});

describe('SelectSessionAction', () => {
	const executeCommand = vi.fn(async () => undefined);
	const openEditor = vi.fn(async () => undefined);
	const pickFn = vi.fn(async (): Promise<QuickPickItem | undefined> => undefined);

	let foregroundSession: ILanguageRuntimeSession | undefined;
	let sessionsById: Map<string, ILanguageRuntimeSession>;

	const ctx = createLightTestContainer()
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
				owner: 'user',
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

	const ctx = createLightTestContainer()
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

describe('DiscoverAllRuntimesAction', () => {
	const discovery = { current: new DeferredPromise<void>() };
	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(IRuntimeStartupService, stubInterface<IRuntimeStartupService>({
			rediscoverAllRuntimes: () => discovery.current.p,
		}))
		.build();

	beforeEach(() => {
		discovery.current = new DeferredPromise<void>();
	});

	it('resolves only once discovery has finished', async () => {
		let finished = false;
		const run = ctx.instantiationService.invokeFunction(accessor =>
			new DiscoverAllRuntimesAction().run(accessor)).then(() => { finished = true; });

		await timeout(0);
		expect(finished).toBe(false);

		discovery.current.complete();
		await run;
		expect(finished).toBe(true);
	});
});
