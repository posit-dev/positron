/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './connectDataConnectionWith.css';

// React.
import { PropsWithChildren, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import Severity from '../../../../../base/common/severity.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { IUntitledTextResourceEditorInput } from '../../../../common/editor.js';
import { showIncludeSecretsConfirmation } from './includeSecretsConfirmation.js';
import { GGSQL_INSTALL_LABEL, isGgsqlKnownMissing, openGgsqlInstallPage, showGgsqlNotInstalled } from './ggsqlNotInstalled.js';
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
	// Optional, like the equivalent field on ConnectDataConnectionWithOptions: a caller that has not
	// already fetched secrets opens the dialog secret-free. Defaults to false.
	readonly initialIncludeSecrets?: boolean;
}

/**
 * ConnectDataConnectionWith component.
 * @param props The component props.
 */
export const ConnectDataConnectionWith = (props: PropsWithChildren<ConnectDataConnectionWithProps>) => {
	// Get services.
	const services = usePositronReactServicesContext();

	const editorRef = useRef<EditableCodeEditorWidget>(undefined!);

	// Whether this connection actually has a secret to embed. Both halves are required: the
	// mechanism's schema must declare a secret parameter (falling back to the first mechanism for
	// pre-mechanisms profiles), and the profile must have a value stored for one of them. The schema
	// alone is not enough -- an ODBC DSN or a Postgres trust-auth connection declares a password
	// parameter and leaves it blank -- and treating those as having secrets makes Connect show a
	// "this connection requires secrets" prompt that confirming cannot satisfy, because there is
	// nothing to fetch.
	const mechanism = resolveDataConnectionMechanism(props.driver.metadata, props.mechanismId);
	const secretParameterIds = mechanism?.parameters.filter(isSecretParameter).map(parameter => parameter.id) ?? [];
	const storedSecretIds = services.positronDataConnectionsService.getProfileSecretIds(props.profileId);
	const hasSecrets = secretParameterIds.some(id => storedSecretIds.includes(id));

	// Whether secret parameter values have been embedded in the generated code. Starts from the
	// caller's initialIncludeSecrets (true when the caller already had to fetch secrets to produce
	// any preview at all); otherwise set once the user confirms the Include Secrets action, or
	// confirms the equivalent prompt Connect shows when secrets are required and not yet included.
	// One-way: the dialog reopens secret-free.
	const [includeSecrets, setIncludeSecrets] = useState(props.initialIncludeSecrets ?? false);

	// The connection code variants to display. Initialized with the secret-free variants generated
	// by the caller; replaced with secret-bearing variants once the user includes secrets.
	const [variants, setVariants] = useState(props.variants);

	// Whether this code is ggsql and Positron has no ggsql runtime to run it in. Drives the notice
	// above the code and makes Connect offer to install ggsql instead of failing. Re-checked when a
	// runtime registers or the startup phase advances, so installing ggsql while the dialog is open
	// clears the notice. Best-effort only -- there is no event for the tail of background discovery,
	// so connectHandler re-checks at press time rather than trusting this.
	const [ggsqlMissing, setGgsqlMissing] = useState(() => isGgsqlKnownMissing(services, props.languageId));
	useEffect(() => {
		const disposables = new DisposableStore();
		const recheck = () => setGgsqlMissing(isGgsqlKnownMissing(services, props.languageId));
		disposables.add(services.languageRuntimeService.onDidRegisterRuntime(recheck));
		disposables.add(services.languageRuntimeService.onDidChangeRuntimeStartupPhase(recheck));
		return () => disposables.dispose();
	}, [services, props.languageId]);

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
	// regenerated variants so a caller that needs the code immediately (Connect) does not have to
	// wait for the state update to re-render, or undefined when generation produced nothing.
	//
	// An empty result means the secrets could not be read (secret storage unavailable, or the
	// profile's stored values are gone). That leaves includeSecrets false, so the Include Secrets
	// action stays available to retry and Connect will not run code that is missing the password it
	// needs while reporting that secrets were included.
	const applySecretVariants = async (): Promise<IDataConnectionCodeVariant[] | undefined> => {
		const secretVariants = await props.generateSecretVariants();
		if (secretVariants.length === 0) {
			services.notificationService.error(localize(
				'positron.connectDataConnectionWith.secretsUnavailable',
				"Could not read this connection's stored secrets. The connection code is unchanged."
			));
			return undefined;
		}
		setVariants(secretVariants);
		setIncludeSecrets(true);
		return secretVariants;
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

		// There is no ggsql runtime to run this code in, so executing it would fail with an internal
		// error about an unregistered runtime. Explain the real problem and offer the install page
		// instead. This dialog stays open behind that one: the code is still worth copying or turning
		// into a script, so this is a detour rather than a dead end. Checked here rather than trusting
		// ggsqlMissing, which can lag behind the tail of runtime discovery.
		if (isGgsqlKnownMissing(services, props.languageId)) {
			setGgsqlMissing(true);
			showGgsqlNotInstalled(services);
			return;
		}

		// Whether the code on screen is still the code we generated. The preview editor is editable,
		// so the user may have rewritten it -- including typing a password in themselves. Regenerating
		// would overwrite that, so an edited buffer is run as-is and the secrets prompt is skipped:
		// the prompt exists to fill in a secret that the generated code is missing, and once the user
		// has taken the code over, we no longer know that it is missing anything.
		const userEditedCode = code !== selectedVariant.code;

		// Secrets are required for this code to actually connect, and the user has not opted in yet
		// (via the Include Secrets action or a previous Connect attempt). Ask now rather than running
		// code that is missing a password. This also covers the case where the initial preview had no
		// secret-free variant to show at all (the mechanism's only parameter is a secret): the caller
		// still requires an explicit opt-in to reveal it, so it prompts through here on the first
		// Connect click instead of silently including it in the code the dialog opened with.
		if (hasSecrets && !includeSecrets && !userEditedCode) {
			const confirmed = await showIncludeSecretsConfirmation({ requiredForConnect: true });
			if (!confirmed) {
				// Stay in the dialog; the user declined to include the secrets Connect needs.
				return;
			}
			const updatedVariants = await applySecretVariants();
			if (!updatedVariants) {
				// Stay in the dialog; applySecretVariants has already reported why. Connecting now
				// would run code the user was just told would include secrets, without them.
				return;
			}
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
				<div className={positronClassNames('connect-data-connection-with', { 'has-variants': showVariantSelector, 'has-notice': ggsqlMissing })}>
					{ggsqlMissing &&
						<div className='notice'>
							<span className='codicon codicon-info' />
							<span className='notice-text'>
								{localize(
									'positron.connectDataConnectionWith.ggsqlNotInstalled',
									"ggsql is not installed. You can still copy this code or create a script for it."
								)}
							</span>
							<Button
								ariaLabel={localize('positron.connectDataConnectionWith.goToGgsqlSite', "Go to ggsql.org")}
								className='notice-link'
								onPressed={() => openGgsqlInstallPage(services)}
							>
								{GGSQL_INSTALL_LABEL}
							</Button>
						</div>
					}
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
