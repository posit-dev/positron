/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './connectDataConnectionWith.css';

// React.
import { PropsWithChildren, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import Severity from '../../../../../base/common/severity.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalDialogReactRenderer } from '../../../../../base/browser/positronModalDialogReactRenderer.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { DataConnectionCodeEditor, DataConnectionCodeEditorWidget } from '../components/dataConnectionCodeEditor.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { IDataConnectionCodeVariant } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of the Connect Data Connection With dialog.
const CONNECT_DATA_CONNECTION_WITH_WIDTH = 800;

/**
 * Options for showing the Connect Data Connection With dialog.
 */
export interface ConnectDataConnectionWithOptions {
	// The id of the language the connection code is written in (e.g. 'python', 'r', 'sql').
	readonly languageId: string;

	// The display name of the connection, shown in the summary band below the title bar.
	readonly connectionName: string;

	// The display name of the data source / driver (e.g. 'SQLite', 'DuckDB'), shown in the summary band.
	readonly driverName: string;

	// The available connection code variants, in preference order (first is the default). Must be
	// non-empty.
	readonly variants: IDataConnectionCodeVariant[];
}

/**
 * Shows the Connect Data Connection With dialog, which previews the generated connection code and
 * lets the user pick a variant, copy it, or run it in a console session.
 * @param options The dialog options.
 */
export const showConnectDataConnectionWith = (options: ConnectDataConnectionWithOptions) => {
	// Create the renderer.
	const renderer = new PositronModalDialogReactRenderer();

	// Render the dialog.
	renderer.render(
		<ConnectDataConnectionWith
			connectionName={options.connectionName}
			driverName={options.driverName}
			languageId={options.languageId}
			renderer={renderer}
			variants={options.variants}
		/>
	);
};

/**
 * ConnectDataConnectionWithProps interface.
 */
interface ConnectDataConnectionWithProps {
	readonly renderer: PositronModalDialogReactRenderer;
	readonly languageId: string;
	readonly connectionName: string;
	readonly driverName: string;
	readonly variants: IDataConnectionCodeVariant[];
}

/**
 * ConnectDataConnectionWith component.
 * @param props The component props.
 */
const ConnectDataConnectionWith = (props: PropsWithChildren<ConnectDataConnectionWithProps>) => {
	// Get services.
	const services = usePositronReactServicesContext();

	const editorRef = useRef<DataConnectionCodeEditorWidget>(undefined!);

	// The currently-selected variant. Defaults to the first (preferred) variant.
	const [selectedVariantId, setSelectedVariantId] = useState(props.variants[0].id);
	const selectedVariant = props.variants.find(variant => variant.id === selectedVariantId) ?? props.variants[0];

	const copyHandler = async () => {
		const code = editorRef.current.getCode();
		await services.clipboardService.writeText(code);
		props.renderer.dispose();

		const handle = services.notificationService.notify({
			message: localize(
				'positron.connectDataConnectionWith.codeCopied',
				"Connection code copied to clipboard"
			),
			severity: Severity.Info
		});
		// close the notification after 2 seconds
		setTimeout(() => handle.close(), 2000);
	};

	const createScriptHandler = async () => {
		// Acquire code before disposing of the renderer.
		const code = editorRef.current.getCode();

		props.renderer.dispose();

		try {
			// Open a new untitled editor seeded with the connection code, typed to the connection's
			// language so the user gets syntax highlighting and can save it as a script.
			await services.editorService.openEditor({
				resource: undefined,
				contents: code,
				languageId: props.languageId,
				options: { pinned: true },
			} satisfies IUntitledTextResourceEditorInput);
		} catch (err) {
			services.notificationService.error(localize(
				'positron.connectDataConnectionWith.createScriptFailed',
				"Failed to create the connection script: {0}",
				toErrorMessage(err)
			));
		}
	};

	const connectHandler = async () => {
		// Acquire code before disposing of the renderer.
		const code = editorRef.current.getCode();

		props.renderer.dispose();

		try {
			// Run the connection code in a console session, starting or reusing one as needed.
			await services.positronConsoleService.executeCode(
				props.languageId,
				undefined, // session ID - choose or start an appropriate session
				code,
				{ source: CodeAttributionSource.Interactive }, // attribution
				true, // focus the console
			);
		} catch (err) {
			services.notificationService.error(localize(
				'positron.connectDataConnectionWith.connectFailed',
				"Failed to run the connection code: {0}",
				toErrorMessage(err)
			));
		}
	};

	const cancelHandler = () => {
		props.renderer.dispose();
	};

	// Only show the variant selector when there is more than one variant to choose from.
	const showVariantSelector = props.variants.length > 1;

	// The label for the variant selector. The variants are packages -- the install unit in both R
	// and Python -- so "Package" is correct for every language.
	const variantGroupLabel = localize('positron.connectDataConnectionWith.package', "Package");

	// The user-visible name for the language (e.g. 'Python'), falling back to the id when no
	// display name is registered.
	const languageName = services.languageService.getLanguageName(props.languageId) ?? props.languageId;

	return (
		<PositronDynamicModalDialog
			content={
				<div className='connect-data-connection-with-content'>
					<div className='connection-summary'>
						{localize('positron.connectDataConnectionWith.summary', "Connect {0} · {1} with {2}", props.connectionName, props.driverName, languageName)}
					</div>
					<div className={positronClassNames('connect-data-connection-with', { 'has-variants': showVariantSelector })}>
						{showVariantSelector &&
							<div className='library-header'>{variantGroupLabel}</div>
						}
						<div className='code-header'>
							<span className='code-title'>{localize('positron.connectDataConnectionWith.code', "Connection Code")}</span>
							<div className='code-actions'>
								<Button
									className='button dialog-button small'
									disabled={!selectedVariant.code}
									onPressed={createScriptHandler}
								>
									{localize('positron.connectDataConnectionWith.createScript', "Create Script")}
								</Button>
								<Button
									className='button dialog-button small'
									disabled={!selectedVariant.code}
									onPressed={copyHandler}
								>
									{localize('positron.connectDataConnectionWith.copy', "Copy")}
								</Button>
							</div>
						</div>
						{showVariantSelector &&
							<div aria-label={variantGroupLabel} className='variant-list' role='listbox'>
								{props.variants.map(variant =>
									<Button
										key={variant.id}
										ariaSelected={variant.id === selectedVariant.id}
										className={positronClassNames('variant-list-item', { 'selected': variant.id === selectedVariant.id })}
										role='option'
										onPressed={() => setSelectedVariantId(variant.id)}
									>
										{variant.label}
									</Button>
								)}
							</div>
						}
						<div className='code'>
							<DataConnectionCodeEditor
								key={selectedVariant.id}
								ref={editorRef}
								code={selectedVariant.code}
								languageId={props.languageId}
							></DataConnectionCodeEditor>
						</div>
					</div>
				</div>
			}
			footer={
				<TwoButtonFooter
					primaryButtonTitle={localize('positron.connectDataConnectionWith.connect', "Connect")}
					secondaryButtonTitle={localize('positron.connectDataConnectionWith.cancel', "Cancel")}
					onPrimaryButton={connectHandler}
					onSecondaryButton={cancelHandler}
				/>
			}
			renderer={props.renderer}
			title={localize('positron.connectDataConnectionWith.title', "Connect with {0}", languageName)}
			width={CONNECT_DATA_CONNECTION_WITH_WIDTH}
			onCancel={cancelHandler}
		/>
	);
};
