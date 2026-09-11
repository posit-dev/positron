/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { INotification, INotificationHandle, INotificationService, Severity } from '../../../../../platform/notification/common/notification.js';
import { IEditorPane } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorResolution, IResourceEditorInput } from '../../../../../platform/editor/common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { ILanguageRuntimeMetadata } from '../../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { ImportDataModalDialogOptions } from '../../../../browser/positronModalDialogs/importDataModalDialog.js';
import { IDataImporter, IDataImportView, IPositronDataImporterRegistry } from '../../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
import { IPositronDataExplorerService } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { PositronDataExplorerUri } from '../../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { PositronDataExplorerEditorInput } from '../../browser/positronDataExplorerEditorInput.js';
import {
	IImportDataServices,
	importDataResourceArgument,
	openFileAndShowImportDataDialog,
	showImportDataDialogForInstance,
} from '../../browser/positronDataExplorerImportData.js';

const csvUri = URI.file('/data/flights.csv');

const pandasImporter = stubInterface<IDataImporter>({
	languageId: 'python',
	displayName: 'Python (pandas)',
	fileExtensions: ['csv', 'tsv'],
});

function makeInstance(overrides?: Partial<IPositronDataExplorerInstance>): IPositronDataExplorerInstance {
	return stubInterface<IPositronDataExplorerInstance>({
		fileHasHeaderRow: true,
		fileSelectedSheet: undefined,
		getImportView: async () => undefined,
		...overrides,
	});
}

interface TestHarness {
	services: IImportDataServices;
	calls: {
		// The resource is recorded as a string: URI memoizes its serialized form on first
		// toString(), so comparing the objects makes the assertion depend on whether the
		// production code happened to stringify the URI.
		openedEditors: { resource: string; override?: string | EditorResolution }[];
		importerLookups: string[];
		notifications: { severity: Severity; message: string }[];
	};
	shownDialogs: ImportDataModalDialogOptions[];
	showDialog: (options: ImportDataModalDialogOptions) => void;
}

function makeHarness(opts: {
	instance?: IPositronDataExplorerInstance;
	/**
	 * An instance already registered for the file. The service keeps these registered after
	 * the editor closes, so `explorerEditorOpen` controls whether one is still live.
	 */
	openInstance?: IPositronDataExplorerInstance;
	/** Whether an editor for the generated positron-data-explorer URI is open. */
	explorerEditorOpen?: boolean;
	importers?: IDataImporter[];
	remoteAuthority?: string;
	foregroundLanguageId?: string;
} = {}): TestHarness {
	const calls: TestHarness['calls'] = { openedEditors: [], importerLookups: [], notifications: [] };
	const shownDialogs: ImportDataModalDialogOptions[] = [];
	const services: IImportDataServices = {
		editorService: stubInterface<IEditorService>({
			editors: opts.explorerEditorOpen
				? [stubInterface<EditorInput>({
					resource: PositronDataExplorerUri.generate(`duckdb:${csvUri.toString()}`),
				})]
				: [],
			// openEditor is overloaded five ways; the flow only ever calls the
			// IResourceEditorInput one, so the stub implements that signature and is
			// cast to the full set rather than restating the four it never receives.
			openEditor: (async (editor: IResourceEditorInput): Promise<IEditorPane | undefined> => {
				calls.openedEditors.push({ resource: editor.resource.toString(), override: editor.options?.override });
				return undefined;
			}) as IEditorService['openEditor'],
		}),
		environmentService: stubInterface<IWorkbenchEnvironmentService>({
			remoteAuthority: opts.remoteAuthority,
		}),
		importerRegistry: stubInterface<IPositronDataImporterRegistry>({
			getImporters: async (fileExtension: string) => {
				calls.importerLookups.push(fileExtension);
				return opts.importers ?? [pandasImporter];
			},
		}),
		notificationService: stubInterface<INotificationService>({
			notify: (notification: INotification): INotificationHandle => {
				calls.notifications.push({
					severity: notification.severity,
					message: String(notification.message),
				});
				return stubInterface<INotificationHandle>();
			},
		}),
		positronDataExplorerService: stubInterface<IPositronDataExplorerService>({
			getInstance: (_identifier: string) => opts.openInstance,
			getInstanceAsync: async (_identifier: string) => opts.instance,
		}),
		runtimeSessionService: stubInterface<IRuntimeSessionService>({
			foregroundSession: opts.foregroundLanguageId
				? stubInterface<ILanguageRuntimeSession>({
					runtimeMetadata: stubInterface<ILanguageRuntimeMetadata>({
						languageId: opts.foregroundLanguageId,
					}),
				})
				: undefined,
		}),
	};
	return { services, calls, shownDialogs, showDialog: options => shownDialogs.push(options) };
}

describe('importDataResourceArgument', () => {
	test('keeps a URI named by the Explorer context menu', () => {
		expect(importDataResourceArgument(csvUri)).toStrictEqual(csvUri);
	});

	test('discards the native menubar payload so the file picker opens', () => {
		// The native menubar runs the command with { from: 'menu' } instead of no argument.
		expect(importDataResourceArgument({ from: 'menu' })).toStrictEqual(undefined);
	});

	test('discards a missing argument', () => {
		expect(importDataResourceArgument(undefined)).toStrictEqual(undefined);
	});
});

describe('showImportDataDialogForInstance', () => {
	test('looks up importers by extension and shows the dialog with instance state', async () => {
		const harness = makeHarness({ foregroundLanguageId: 'python' });
		await showImportDataDialogForInstance(
			harness.services, csvUri, makeInstance(), harness.showDialog
		);
		expect(harness.calls.importerLookups).toStrictEqual(['.csv']);
		expect(harness.shownDialogs).toStrictEqual([{
			fileUri: csvUri,
			importers: [pandasImporter],
			options: { hasHeaderRow: true, sheetName: undefined },
			preferredLanguageId: 'python',
			view: undefined,
		}]);
	});

	test('offers no importers for a file the session machine cannot see', async () => {
		// A client-local file:// URI inside a remote window names a path the
		// runtime session cannot open, so the dialog gets its empty state.
		const harness = makeHarness({ remoteAuthority: 'ssh-remote+box' });
		await showImportDataDialogForInstance(
			harness.services, csvUri, makeInstance(), harness.showDialog
		);
		expect(harness.calls.importerLookups).toStrictEqual([]);
		expect(harness.shownDialogs[0].importers).toStrictEqual([]);
	});

	it('passes the instance import view to the dialog', async () => {
		const view: IDataImportView = {
			rowFilters: [],
			sortKeys: [{ columnName: 'dep_delay', ascending: false }],
		};
		const instance = makeInstance({ getImportView: async () => view });
		const harness = makeHarness({ importers: [pandasImporter] });

		await showImportDataDialogForInstance(harness.services, csvUri, instance, harness.showDialog);

		expect(harness.shownDialogs[0].view).toEqual(view);
	});

	it('still shows the dialog with no view when getImportView rejects', async () => {
		const instance = makeInstance({ getImportView: async () => { throw new Error('backend busy'); } });
		const harness = makeHarness({ importers: [pandasImporter] });

		await showImportDataDialogForInstance(harness.services, csvUri, instance, harness.showDialog);

		expect(harness.shownDialogs).toHaveLength(1);
		expect(harness.shownDialogs[0].view).toBeUndefined();
	});
});

describe('openFileAndShowImportDataDialog', () => {
	test('opens the file in the Data Explorer, waits for the instance, shows the dialog', async () => {
		const harness = makeHarness({ instance: makeInstance({ fileSelectedSheet: undefined }) });
		await openFileAndShowImportDataDialog(harness.services, csvUri, harness.showDialog);
		expect(harness.calls.openedEditors).toStrictEqual([{
			resource: csvUri.toString(),
			override: PositronDataExplorerEditorInput.EditorID,
		}]);
		expect(harness.shownDialogs).toHaveLength(1);
		expect(harness.shownDialogs[0].fileUri).toStrictEqual(csvUri);
	});

	test('reuses the Data Explorer already showing the file instead of reopening it', async () => {
		// Reopening the file URI would build a second DuckDB backend under the same identifier,
		// so the dialog must read the open instance's worksheet and header-row settings.
		const harness = makeHarness({
			explorerEditorOpen: true,
			openInstance: makeInstance({ fileHasHeaderRow: false, fileSelectedSheet: 'Q3' }),
			instance: makeInstance({ fileHasHeaderRow: true, fileSelectedSheet: undefined }),
		});
		await openFileAndShowImportDataDialog(harness.services, csvUri, harness.showDialog);
		expect(harness.calls.openedEditors).toStrictEqual([{
			resource: PositronDataExplorerUri.generate(`duckdb:${csvUri.toString()}`).toString(),
			override: undefined,
		}]);
		expect(harness.shownDialogs).toHaveLength(1);
		expect(harness.shownDialogs[0].options).toStrictEqual({
			hasHeaderRow: false,
			sheetName: 'Q3',
		});
	});

	test('opens a fresh backend when the file registered an instance but its editor was closed', async () => {
		// Closing a DuckDB editor disposes its client but leaves the instance registered, so a
		// registered instance with no open editor must not be reused - reopening the file URI is
		// what builds a live backend.
		const harness = makeHarness({
			explorerEditorOpen: false,
			openInstance: makeInstance({ fileHasHeaderRow: false, fileSelectedSheet: 'Q3' }),
			instance: makeInstance({ fileHasHeaderRow: true, fileSelectedSheet: undefined }),
		});
		await openFileAndShowImportDataDialog(harness.services, csvUri, harness.showDialog);
		expect(harness.calls.openedEditors).toStrictEqual([{
			resource: csvUri.toString(),
			override: PositronDataExplorerEditorInput.EditorID,
		}]);
		expect(harness.shownDialogs[0].options).toStrictEqual({
			hasHeaderRow: true,
			sheetName: undefined,
		});
	});

	test('notifies and shows no dialog when no instance appears', async () => {
		const harness = makeHarness({ instance: undefined });
		await openFileAndShowImportDataDialog(harness.services, csvUri, harness.showDialog);
		expect(harness.shownDialogs).toStrictEqual([]);
		expect(harness.calls.notifications).toHaveLength(1);
		expect(harness.calls.notifications[0].severity).toStrictEqual(Severity.Error);
	});
});
