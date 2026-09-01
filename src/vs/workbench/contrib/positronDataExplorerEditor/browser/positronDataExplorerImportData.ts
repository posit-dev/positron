/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { basename, extname, isEqual } from '../../../../base/common/resources.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPositronDataExplorerService } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerService.js';
import { IPositronDataExplorerInstance } from '../../../services/positronDataExplorer/browser/interfaces/positronDataExplorerInstance.js';
import { IPositronDataImporterRegistry } from '../../../services/positronDataExplorer/common/positronDataImporterRegistry.js';
import { isSessionVisibleFile } from '../../../services/positronDataExplorer/common/importDataFileUri.js';
import { PositronDataExplorerUri } from '../../../services/positronDataExplorer/common/positronDataExplorerUri.js';
import { ImportDataModalDialogOptions, showImportDataModalDialog } from '../../../browser/positronModalDialogs/importDataModalDialog.js';
import { PositronDataExplorerEditorInput } from './positronDataExplorerEditorInput.js';

/**
 * The services the import-data flow needs. Callers collect these from a ServicesAccessor before
 * the first await, because an accessor is only valid synchronously.
 */
export interface IImportDataServices {
	readonly editorService: IEditorService;
	readonly environmentService: IWorkbenchEnvironmentService;
	readonly importerRegistry: IPositronDataImporterRegistry;
	readonly notificationService: INotificationService;
	readonly positronDataExplorerService: IPositronDataExplorerService;
	readonly runtimeSessionService: IRuntimeSessionService;
}

/**
 * Normalizes the argument a command handler receives into a file URI. The native menubar runs the
 * command with a `{ from: 'menu' }` payload rather than no argument at all, so a handler that only
 * checks for a missing argument would treat that payload as a file and fail deep inside the editor
 * service. Anything that is not a URI means "no file was named": open the file picker instead.
 * @param arg The first argument passed to the command handler.
 * @returns The named file, or undefined if the argument does not name one.
 */
export function importDataResourceArgument(arg: unknown): URI | undefined {
	return URI.isUri(arg) ? arg : undefined;
}

/**
 * Shows the Import Data dialog for a file that is open in a Data Explorer instance. This is the
 * single dialog code path shared by every entry point (Data Explorer action bar, Explorer context
 * menu, Variables pane button, and File menu item).
 * @param services The workbench services the flow needs.
 * @param fileUri The original file, not the positron-data-explorer URI.
 * @param instance The Data Explorer instance showing the file, which supplies the file options.
 * @param showDialog Injectable for tests; defaults to the real dialog.
 */
export async function showImportDataDialogForInstance(
	services: IImportDataServices,
	fileUri: URI,
	instance: IPositronDataExplorerInstance,
	showDialog: (options: ImportDataModalDialogOptions) => void = showImportDataModalDialog
): Promise<void> {
	// Ask the registry which importers can read this file. This activates contributing
	// extensions, so it must happen before the dialog opens.
	//
	// Offer nothing for a file the runtime session's machine cannot open: the generated code
	// names fileUri.fsPath, and a path the session cannot resolve is worse than no code at all.
	// The dialog renders the empty list as its empty state.
	const importers = isSessionVisibleFile(fileUri, services.environmentService.remoteAuthority)
		? await services.importerRegistry.getImporters(extname(fileUri))
		: [];

	showDialog({
		fileUri,
		importers,
		options: {
			hasHeaderRow: instance.fileHasHeaderRow,
			// Import the sheet the user is looking at, not the workbook's default one.
			sheetName: instance.fileSelectedSheet,
		},
		preferredLanguageId: services.runtimeSessionService.foregroundSession?.runtimeMetadata.languageId,
	});
}

/**
 * Opens a file in the Data Explorer and then shows the Import Data dialog over it. This is the
 * global entry points' path (Explorer context menu, Variables pane button, File menu item): they
 * name a file that may not be open yet, so the Data Explorer is opened first and the dialog reads
 * its state, exactly as if the user had opened the file and clicked Import Data.
 * @param services The workbench services the flow needs.
 * @param fileUri The file to import.
 * @param showDialog Injectable for tests; defaults to the real dialog.
 */
export async function openFileAndShowImportDataDialog(
	services: IImportDataServices,
	fileUri: URI,
	showDialog: (options: ImportDataModalDialogOptions) => void = showImportDataModalDialog
): Promise<void> {
	const identifier = `duckdb:${fileUri.toString()}`;
	const explorerUri = PositronDataExplorerUri.generate(identifier);

	// Reuse the Data Explorer already showing this file, if there is one.
	const explorerEditorIsOpen = services.editorService.editors.some(
		editor => isEqual(editor.resource, explorerUri)
	);
	const openInstance = explorerEditorIsOpen
		? services.positronDataExplorerService.getInstance(identifier)
		: undefined;
	if (openInstance) {
		await services.editorService.openEditor({ resource: explorerUri });
		await showImportDataDialogForInstance(services, fileUri, openInstance, showDialog);
		return;
	}

	// Open the file with the Data Explorer editor. The editor resolver routes supported data
	// files through the DuckDB backend and registers an instance keyed on the file URI.
	await services.editorService.openEditor({
		resource: fileUri,
		options: { override: PositronDataExplorerEditorInput.EditorID },
	});

	// Wait for the instance; a large file can take a moment to register.
	const instance = await services.positronDataExplorerService.getInstanceAsync(identifier);
	if (!instance) {
		services.notificationService.notify({
			severity: Severity.Error,
			message: localize(
				'positron.dataExplorer.importOpenFailed',
				"Could not open {0} in the Data Explorer.",
				basename(fileUri)
			),
			sticky: false,
		});
		return;
	}

	await showImportDataDialogForInstance(services, fileUri, instance, showDialog);
}
