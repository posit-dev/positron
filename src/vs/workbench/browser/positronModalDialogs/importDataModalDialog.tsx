/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './importDataModalDialog.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import Severity from '../../../base/common/severity.js';
import { basename } from '../../../base/common/resources.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { positronClassNames } from '../../../base/common/positronUtilities.js';
import { Button } from '../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../base/browser/positronModalReactRenderer.js';
import { deriveVariableName } from './importDataVariableName.js';
import { LabeledTextInput } from '../positronComponents/positronModalDialog/components/labeledTextInput.js';
import { TwoButtonFooter } from '../positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { CodeAttributionSource } from '../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { EditableCodeEditor, EditableCodeEditorWidget } from '../positronComponents/editableCodeEditor/editableCodeEditor.js';
import { IDataImporter, IDataImportOptions, IDataImportResult } from '../../services/positronDataExplorer/common/positronDataImporterRegistry.js';

// The width of the Import Data dialog. Matches the data connections dialog, which carries the same
// package sidebar plus code preview layout.
const IMPORT_DATA_DIALOG_WIDTH = 800;

/**
 * Options for showing the Import Data dialog.
 */
export interface ImportDataModalDialogOptions {
	/** The file to import. Always the original file, never the positron-data-explorer URI. */
	readonly fileUri: URI;

	/**
	 * The importers that can read this file, sorted by display name. Empty when no extension offers
	 * one, which the dialog renders as an empty state rather than refusing to open: the button's
	 * visibility is keyed on the file, and context keys cannot cheaply reflect async registry
	 * contents.
	 */
	readonly importers: readonly IDataImporter[];

	/** The file options read from the Data Explorer, e.g. whether the first row holds column names. */
	readonly options: IDataImportOptions;

	/** The language of the foreground session, preselected when an importer matches it. */
	readonly preferredLanguageId?: string;
}

/**
 * Shows the Import Data dialog, which previews the code that loads a file into a variable and lets
 * the user copy it or run it in a console session.
 * @param options The dialog options.
 */
export const showImportDataModalDialog = (options: ImportDataModalDialogOptions) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Render the dialog.
	renderer.render(
		<ImportDataModalDialog
			fileUri={options.fileUri}
			importers={options.importers}
			options={options.options}
			preferredLanguageId={options.preferredLanguageId}
			renderer={renderer}
		/>
	);
};

/**
 * ImportDataModalDialogProps interface.
 */
interface ImportDataModalDialogProps extends ImportDataModalDialogOptions {
	readonly renderer: PositronModalReactRenderer;
}

/**
 * ImportDataModalDialog component.
 * @param props The component props.
 */
export const ImportDataModalDialog = (props: ImportDataModalDialogProps) => {
	// Get services.
	const services = usePositronReactServicesContext();

	// Reference hooks.
	const editorRef = useRef<EditableCodeEditorWidget>(undefined!);

	// The importer to generate with. Starts on the one matching the foreground session's language,
	// so the common case (a session is already running) needs no click; falls back to the first.
	const [selectedIndex, setSelectedIndex] = useState(() => {
		const index = props.importers.findIndex(importer => importer.languageId === props.preferredLanguageId);
		return index === -1 ? 0 : index;
	});
	const selectedImporter = props.importers[selectedIndex];

	const fileName = basename(props.fileUri);

	// The name the file derives under the selected importer, which is both the field's starting
	// value and what an emptied field falls back to.
	const derivedName = selectedImporter
		? deriveVariableName(fileName, selectedImporter.reservedNames)
		: '';

	// The target variable name. The dialog does not validate it: the derived default is always
	// assignable, so a name that does not run is one the user typed over it with, and the code
	// preview below already shows them exactly what will run.
	const [variableName, setVariableName] = useState(() => derivedName);

	// Whether the user has typed in the name field. An untouched default follows the selected
	// importer's language; an edited name is the user's and survives a package switch.
	const [variableNameEdited, setVariableNameEdited] = useState(false);

	const selectImporter = (index: number) => {
		setSelectedIndex(index);
		if (!variableNameEdited) {
			setVariableName(deriveVariableName(fileName, props.importers[index].reservedNames));
		}
	};

	// An emptied field generates with the derived default rather than with nothing, so clearing the
	// name previews 'flights <- read_csv(...)' instead of a statement with no left-hand side. The
	// field itself is left alone: the box stays empty and the preview shows what running it now
	// would do. Emptiness is judged on the trimmed value, but the raw value is what gets used, since
	// trimming a name the user typed would be a silent rewrite.
	const effectiveVariableName = variableName.trim().length > 0 ? variableName : derivedName;

	// Identifies the inputs a generation belongs to. Everything the dialog shows is compared against
	// the current key, so a result or error left over from earlier inputs is never displayed, copied
	// or run, including in the window where a newer generation is still in flight.
	const inputKey = `${selectedIndex}:${effectiveVariableName}`;

	// The outcome of the last generation: the generated code and anything the importer could not
	// express, or the reason nothing came back. The two are mutually exclusive, and `error` is kept
	// apart from `unsupported`: one is the importer reporting a limit, the other is the importer
	// declining or breaking. `error` holds the message to show, already formatted.
	const [generation, setGeneration] = useState<{
		readonly key: string;
		readonly result?: IDataImportResult;
		readonly error?: string;
	} | undefined>(undefined);

	// Whatever the current inputs have produced so far, if anything.
	const current = generation?.key === inputKey ? generation : undefined;
	const result = current?.result;
	const generationError = current?.error;

	// Regenerate whenever the inputs change. An in-flight generation whose inputs have moved on is
	// dropped rather than allowed to overwrite the newer outcome.
	useEffect(() => {
		if (!selectedImporter) {
			return;
		}

		let cancelled = false;
		const generate = async () => {
			try {
				const generated = await selectedImporter.generateCode({
					fileUri: props.fileUri,
					variableName: effectiveVariableName,
					options: props.options,
				});
				if (cancelled) {
					return;
				}
				// An importer may decline to generate anything. Say so, rather than leaving an empty
				// preview and disabled buttons with no explanation.
				setGeneration(generated
					? { key: inputKey, result: generated }
					: {
						key: inputKey,
						error: localize(
							'positron.importData.generationDeclined',
							"{0} did not generate import code for this file.",
							selectedImporter.displayName
						)
					}
				);
			} catch (err) {
				if (!cancelled) {
					setGeneration({
						key: inputKey,
						error: localize(
							'positron.importData.generationFailed',
							"Could not generate import code: {0}",
							toErrorMessage(err)
						)
					});
				}
			}
		};
		generate();

		return () => {
			cancelled = true;
		};
	}, [selectedImporter, effectiveVariableName, inputKey, props.fileUri, props.options]);

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	const copyHandler = async () => {
		// Read the live buffer, so a manual edit to the preview is what gets copied. The dialog stays
		// open: copying is a side errand, and the user may still want to run the code or edit it.
		const editedCode = editorRef.current.getCode();
		await services.clipboardService.writeText(editedCode);

		const handle = services.notificationService.notify({
			message: localize('positron.importData.codeCopied', "Import code copied to clipboard"),
			severity: Severity.Info
		});
		// Close the notification after 2 seconds.
		setTimeout(() => handle.close(), 2000);
	};

	const runHandler = async () => {
		// Acquire the code before disposing of the renderer.
		const editedCode = editorRef.current.getCode();

		props.renderer.dispose();

		try {
			// Run the import code in a console session, starting or reusing one as needed.
			await services.positronConsoleService.executeCode(
				selectedImporter.languageId,
				undefined, // session id -- choose or start an appropriate session
				editedCode,
				{ source: CodeAttributionSource.Interactive }, // attribution
				true, // focus the console
				// Skip the Console's completeness check and submit the code as-is. Import is a
				// "run this now" action, so incomplete code (e.g. a variable name that is a
				// reserved keyword) should come back as the runtime's syntax error rather than
				// leaving the Console sitting at a continuation prompt.
				true, // allowIncomplete
			);
		} catch (err) {
			services.notificationService.error(localize(
				'positron.importData.runFailed',
				"Failed to run the import code: {0}",
				toErrorMessage(err)
			));
		}
	};

	// The generated code, or the empty string when there is nothing to show yet. Having no code is
	// the only thing that stops Copy and Import, and it covers every case that should: the empty
	// state, a generation still in flight, and an importer that declined or threw.
	const code = result?.code ?? '';
	const canRun = code.length > 0;

	// The importers are packages (the install unit in both R and Python) so "Package" is
	// correct for every language.
	const packageLabel = localize('positron.importData.package', "Package");

	return (
		<PositronDynamicModalDialog
			content={
				<div className='import-data'>
					{props.importers.length === 0
						? <div className='empty-state'>
							{localize(
								'positron.importData.noImporters',
								"No extension can generate code to import this file."
							)}
						</div>
						: <>
							<div className='name-field'>
								<LabeledTextInput
									label={localize('positron.importData.name', "Variable Name")}
									value={variableName}
									onChange={event => {
										setVariableNameEdited(true);
										setVariableName(event.target.value);
									}}
								/>
							</div>
							<div className='body'>
								<div className='package-header'>{packageLabel}</div>
								<div className='code-header'>
									<span className='code-title'>{localize('positron.importData.code', "Code")}</span>
									<Button
										className='button dialog-button small'
										disabled={!canRun}
										onPressed={copyHandler}
									>
										{localize('positron.importData.copyCode', "Copy")}
									</Button>
								</div>
								{/*
									The list is shown even for a lone importer, so the user can always see
									which package is writing the code.
								*/}
								<div aria-label={packageLabel} className='importer-list' role='listbox'>
									{props.importers.map((importer, index) =>
										<Button
											key={`${importer.languageId}-${importer.displayName}`}
											ariaSelected={index === selectedIndex}
											className={positronClassNames('importer-list-item', { 'selected': index === selectedIndex })}
											role='option'
											onPressed={() => selectImporter(index)}
										>
											{importer.displayName}
										</Button>
									)}
								</div>
								<div className='code'>
									<EditableCodeEditor
										// The editor seeds its content once on mount, so key on the code
										// itself to remount whenever the generated code changes.
										key={code}
										ref={editorRef}
										ariaLabel={localize('positron.importData.codeEditorLabel', "Import Code")}
										code={code}
										languageId={selectedImporter.languageId}
									></EditableCodeEditor>
								</div>
							</div>
						</>
					}
					{(generationError || (result?.unsupported?.length ?? 0) > 0) &&
						<div className='warnings' role='alert'>
							{generationError
								?? localize('positron.importData.unsupported', "Not included in the generated code: {0}", result!.unsupported!.join(', '))
							}
						</div>
					}
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonDisabled={!canRun}
					primaryButtonTitle={localize('positron.importData.import', "Import")}
					secondaryButtonTitle={localize('positron.importData.cancel', "Cancel")}
					onPrimaryButton={runHandler}
					onSecondaryButton={cancelHandler}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.importData.title', "Import {0}", fileName)}
			width={IMPORT_DATA_DIALOG_WIDTH}
			onCancel={cancelHandler}
		/>
	);
};
