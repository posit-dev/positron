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
import { showIncludeSecretsConfirmation } from './includeSecretsConfirmation.js';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { CodeAttributionSource } from '../../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { EditableCodeEditor, EditableCodeEditorWidget } from '../../../../browser/positronComponents/editableCodeEditor/editableCodeEditor.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';
import { IDataConnectionCodeVariant, IDataConnectionDriver, isSecretParameter, resolveDataConnectionMechanism } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

// The width of the Connect Data Connection With dialog.
const CONNECT_DATA_CONNECTION_WITH_WIDTH = 800;

/**
 * Options for showing the Connect Data Connection With dialog.
 */
export interface ConnectDataConnectionWithOptions {
	// The id of the language the connection code is written in (e.g. 'python', 'r', 'sql').
	readonly languageId: string;

	// The display name of the connection, shown in the dialog title.
	readonly connectionName: string;

	// The driver for this connection. Used for the title (driver name) and to detect whether the
	// connection has any secret parameters (which surfaces the Include Secrets action).
	readonly driver: IDataConnectionDriver;

	// The id of the mechanism this connection was configured with. Determines which of the driver's
	// parameters define the connection's secret schema.
	readonly mechanismId: string;

	// The id of the data connection profile. Used to read and persist the user's preferred code
	// variant for this profile and language.
	readonly profileId: string;

	// Regenerates the connection code variants with secret values (e.g. passwords) embedded. Invoked
	// only after the user confirms the Include Secrets action; pulls secrets from secret storage.
	readonly generateSecretVariants: () => Promise<IDataConnectionCodeVariant[]>;

	// The available connection code variants, in preference order (first is the default). Generated
	// with secret values omitted (the default, secret-free preview). Must be non-empty.
	readonly variants: IDataConnectionCodeVariant[];

	// Whether the caller already confirmed including secrets and `variants` already has them embedded
	// (e.g. when the mechanism has no non-secret parameters, so a secret-free preview would be empty).
	// Defaults to false. When true, the Include Secrets action starts disabled and Connect does not
	// re-prompt.
	readonly initialIncludeSecrets?: boolean;
}

/**
 * Shows the Connect Data Connection With dialog, which previews the generated connection code and
 * lets the user pick a variant, copy it, or run it in a console session.
 * @param options The dialog options.
 */
export const showConnectDataConnectionWith = (options: ConnectDataConnectionWithOptions) => {
	// Create the renderer.
	const renderer = new PositronModalReactRenderer();

	// Render the dialog.
	renderer.render(
		<ConnectDataConnectionWith
			connectionName={options.connectionName}
			driver={options.driver}
			generateSecretVariants={options.generateSecretVariants}
			initialIncludeSecrets={options.initialIncludeSecrets ?? false}
			languageId={options.languageId}
			mechanismId={options.mechanismId}
			profileId={options.profileId}
			renderer={renderer}
			variants={options.variants}
		/>
	);
};

/**
 * ConnectDataConnectionWithProps interface.
 */
interface ConnectDataConnectionWithProps {
	readonly renderer: PositronModalReactRenderer;
	readonly languageId: string;
	readonly connectionName: string;
	readonly driver: IDataConnectionDriver;
	readonly mechanismId: string;
	readonly profileId: string;
	readonly generateSecretVariants: () => Promise<IDataConnectionCodeVariant[]>;
	readonly variants: IDataConnectionCodeVariant[];
	readonly initialIncludeSecrets: boolean;
}

/**
 * ConnectDataConnectionWith component.
 * @param props The component props.
 */
export const ConnectDataConnectionWith = (props: PropsWithChildren<ConnectDataConnectionWithProps>) => {
	// Get services.
	const services = usePositronReactServicesContext();

	const editorRef = useRef<EditableCodeEditorWidget>(undefined!);

	// Whether the connection's mechanism has any secret parameters (e.g. a password) whose values we
	// keep out of the generated code unless the user opts in. Falls back to the first mechanism for
	// pre-mechanisms profiles.
	const mechanism = resolveDataConnectionMechanism(props.driver.metadata, props.mechanismId);
	const hasSecrets = mechanism?.parameters.some(isSecretParameter) ?? false;

	// Whether secret parameter values have been embedded in the generated code. Starts from the
	// caller's initialIncludeSecrets (true when the caller already had to fetch secrets to produce
	// any preview at all); otherwise set once the user confirms the Include Secrets action, or
	// confirms the equivalent prompt Connect shows when secrets are required and not yet included.
	// One-way: the dialog reopens secret-free.
	const [includeSecrets, setIncludeSecrets] = useState(props.initialIncludeSecrets);

	// The connection code variants to display. Initialized with the secret-free variants generated
	// by the caller; replaced with secret-bearing variants once the user includes secrets.
	const [variants, setVariants] = useState(props.variants);

	// The currently-selected variant. Initialized from the profile's stored preference (falling back
	// to the first/default variant when unset or stale). Variant ids are stable across
	// regeneration, so the selection survives including secrets.
	const storedVariantId = services.positronDataConnectionsService.getProfile(props.profileId)?.preferredCodeVariants?.[props.languageId];
	const [selectedVariantId, setSelectedVariantIdState] = useState(
		props.variants.some(variant => variant.id === storedVariantId) ? storedVariantId! : props.variants[0].id
	);
	const selectedVariant = variants.find(variant => variant.id === selectedVariantId) ?? variants[0];

	// Selects a variant and persists it as the profile's preferred variant for this language.
	const setSelectedVariantId = (variantId: string) => {
		setSelectedVariantIdState(variantId);
		services.positronDataConnectionsService.setPreferredCodeVariant(props.profileId, props.languageId, variantId);
	};

	// Regenerates the variants with secrets embedded and applies them to component state, without
	// prompting -- callers show whichever confirmation wording fits their context first. Returns the
	// regenerated variants (or the current ones, if generation yields nothing) so a caller that needs
	// the code immediately (Connect) does not have to wait for the state update to re-render.
	const applySecretVariants = async (): Promise<IDataConnectionCodeVariant[]> => {
		const secretVariants = await props.generateSecretVariants();
		if (secretVariants.length > 0) {
			setVariants(secretVariants);
		}
		setIncludeSecrets(true);
		return secretVariants.length > 0 ? secretVariants : variants;
	};

	const includeSecretsHandler = async () => {
		// Warn before embedding secrets: the generated code can leak credentials into console
		// history, the clipboard, or a saved script.
		const confirmed = await showIncludeSecretsConfirmation();
		if (!confirmed) {
			return;
		}
		await applySecretVariants();
	};

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
		let code = editorRef.current.getCode();

		// Secrets are required for this code to actually connect, and the user has not opted in yet
		// (via the Include Secrets action or a previous Connect attempt). Ask now rather than running
		// code that is missing a password. This also covers the case where the initial preview had no
		// secret-free variant to show at all (the mechanism's only parameter is a secret): the caller
		// still requires an explicit opt-in to reveal it, so it prompts through here on the first
		// Connect click instead of silently including it in the code the dialog opened with.
		if (hasSecrets && !includeSecrets) {
			const confirmed = await showIncludeSecretsConfirmation({ requiredForConnect: true });
			if (!confirmed) {
				// Stay in the dialog; the user declined to include the secrets Connect needs.
				return;
			}
			const updatedVariants = await applySecretVariants();
			const updatedVariant = updatedVariants.find(variant => variant.id === selectedVariant.id) ?? updatedVariants[0];
			code = updatedVariant.code;
		}

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
	const showVariantSelector = variants.length > 1;

	// The label for the variant selector. The variants are packages -- the install unit in both R
	// and Python -- so "Package" is correct for every language.
	const variantGroupLabel = localize('positron.connectDataConnectionWith.package', "Package");

	// The user-visible name for the language (e.g. 'Python'), falling back to the id when no
	// display name is registered.
	const languageName = services.languageService.getLanguageName(props.languageId) ?? props.languageId;

	return (
		<PositronDynamicModalDialog
			content={
				<div className={positronClassNames('connect-data-connection-with', { 'has-variants': showVariantSelector })}>
					{showVariantSelector &&
						<div className='library-header'>{variantGroupLabel}</div>
					}
					<div className='code-header'>
						<span className='code-title'>{localize('positron.connectDataConnectionWith.code', "Connection Code")}</span>
						<div className='code-actions'>
							{hasSecrets &&
								<Button
									className='button dialog-button small'
									disabled={includeSecrets}
									onPressed={includeSecretsHandler}
								>
									{localize('positron.connectDataConnectionWith.includeSecrets', "Include Secrets")}
								</Button>
							}
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
							{variants.map(variant =>
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
						<EditableCodeEditor
							// The editor seeds its content once on mount, so key on the code itself to
							// remount whenever the displayed code changes -- switching variants or
							// toggling secret values both alter the code.
							key={selectedVariant.code}
							ref={editorRef}
							code={selectedVariant.code}
							languageId={props.languageId}
						></EditableCodeEditor>
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
			title={localize('positron.connectDataConnectionWith.summary', "Connect {0} · {1} with {2}", props.connectionName, props.driver.metadata.name, languageName)}
			width={CONNECT_DATA_CONNECTION_WITH_WIDTH}
			onCancel={cancelHandler}
		/>
	);
};
