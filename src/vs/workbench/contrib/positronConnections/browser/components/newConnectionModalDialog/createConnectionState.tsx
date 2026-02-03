/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './createConnectionState.css';

// React.
import React, { PropsWithChildren, useEffect, useMemo, useRef, useState } from 'react';

// Other dependencies.
import { PositronButton } from '../../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { localize } from '../../../../../../nls.js';
import { SimpleCodeEditor, SimpleCodeEditorWidget } from '../simpleCodeEditor.js';
import Severity from '../../../../../../base/common/severity.js';
import { IDriver, Input } from '../../../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { LabeledTextInput } from '../../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { RadioGroup } from '../../../../../browser/positronComponents/positronModalDialog/components/radioGroup.js';
import { DropDownListBox } from '../../../../../browser/positronComponents/dropDownListBox/dropDownListBox.js';
import { DropDownListBoxItem } from '../../../../../browser/positronComponents/dropDownListBox/dropDownListBoxItem.js';
import { usePositronReactServicesContext } from '../../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../../base/browser/positronModalReactRenderer.js';
import { Icon } from '../../../../../../platform/positronActionBar/browser/components/icon.js';
import { positronClassNames } from '../../../../../../base/common/positronUtilities.js';
import { Codicon } from '../../../../../../base/common/codicons.js';

interface CreateConnectionProps {
	readonly renderer: PositronModalReactRenderer;
	readonly onCancel: () => void;
	readonly onBack: () => void;
	readonly selectedDriver: IDriver;
}

export const CreateConnection = (props: PropsWithChildren<CreateConnectionProps>) => {
	const services = usePositronReactServicesContext();
	const { generateCode, metadata } = props.selectedDriver;
	const { name, languageId } = metadata;
	const { onBack, onCancel } = props;
	const editorRef = useRef<SimpleCodeEditorWidget>(undefined!);

	const [inputs, setInputs] = useState<Array<Input>>(metadata.inputs);
	const [codeState, setCodeState] = useState<{ code: string; errorMessage?: string } | undefined>(undefined);

	const editorOptions = useMemo(() => ({
		readOnly: true,
		cursorBlinking: 'solid' as const
	}), []);

	useEffect(() => {
		// Debounce the code generation to avoid unnecessary re-renders
		const timeoutId = setTimeout(async () => {
			if (generateCode) {
				const result = await generateCode(inputs);
				if (typeof result === 'string') {
					setCodeState({ code: result });
				} else {
					setCodeState(result);
				}
			}
		}, 200);
		return () => clearTimeout(timeoutId);
	}, [inputs, generateCode, setCodeState]);

	const onConnectHandler = async () => {
		// Acquire code before disposing of the renderer
		const code = editorRef.current?.getValue();

		props.renderer.dispose();
		const handle = services.notificationService.notify({
			message: localize(
				'positron.newConnectionModalDialog.createConnection.connecting',
				"Connecting to data source ({0})...",
				name
			),
			severity: Severity.Info
		});

		try {
			if (!props.selectedDriver.connect) {
				throw new Error(
					localize('positron.newConnectionModalDialog.createConnection.connectNotImplemented', "Connect method not implemented")
				);
			}

			if (props.selectedDriver.checkDependencies && props.selectedDriver.installDependencies) {
				let dependenciesInstalled = false;
				try {
					dependenciesInstalled = await props.selectedDriver.checkDependencies();
				} catch (err) {
					services.notificationService.error(localize(
						'positron.newConnectionModalDialog.createConnection.failedToCheckDependencies',
						'Failed to check if dependencies are installed: {}',
						err
					));
					// If we fail to check if dependencies are installed, we presume they are installed
					// and let the user try to connect anyway so they don't get blocked.
					dependenciesInstalled = true;
				}

				if (!dependenciesInstalled) {
					await props.selectedDriver.installDependencies();
				}
			}

			await props.selectedDriver.connect(code);
		} catch (err) {
			services.notificationService.error(err);
		}

		handle.close();
	};

	const onCopy = async () => {
		const code = editorRef.current.getValue();
		await services.clipboardService.writeText(code);

		const handle = services.positronConnectionsService.notify(localize(
			'positron.resumeConnectionModalDialog.codeCopied',
			"Connection code copied to clipboard"
		), Severity.Info);
		// close the notification after 2 seconds
		setTimeout(() => handle.close(), 2000);
	};

	return <div className='connections-new-connection-create-connection'>
		<div className='create-connection-title'>
			<h1>
				{(() => `${name} ${localize('positron.newConnectionModalDialog.createConnection.title', "Connection")}`)()}
			</h1>
		</div>

		<Form inputs={metadata.inputs} onInputsChange={setInputs}></Form>

		<div className='create-connection-code-title'>
			{(() => localize('positron.newConnectionModalDialog.createConnection.code', "Connection Code"))()}
		</div>

		<div className={positronClassNames('create-connection-code-editor', { 'has-error': codeState?.errorMessage })}>
			<SimpleCodeEditor
				ref={editorRef}
				code={codeState?.code || ''}
				editorOptions={editorOptions}
				language={languageId}
			>
			</SimpleCodeEditor>
			{codeState?.errorMessage && (
				<div className='connection-error-message'>
					<Icon icon={Codicon.error} />
					{codeState.errorMessage}
				</div>
			)}
		</div>

		<div className='create-connection-buttons'>
			<PositronButton
				className='button action-bar-button'
				onPressed={onCopy}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.copy', 'Copy'))()}
			</PositronButton>
			<PositronButton
				className='button action-bar-button'
				onPressed={onCancel}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.cancel', 'Cancel'))()}
			</PositronButton>
		</div>

		<div className='create-connection-footer'>
			<PositronButton
				className='button action-bar-button'
				onPressed={onBack}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.back', 'Back'))()}
			</PositronButton>
			<PositronButton
				className={`button action-bar-button`}
				disabled={!codeState || !!codeState.errorMessage}
				onPressed={onConnectHandler}
			>
				{(() => localize('positron.newConnectionModalDialog.createConnection.connect', 'Connect'))()}
			</PositronButton>
		</div>
	</div>;
};

const Form = (props: PropsWithChildren<{ inputs: Input[], onInputsChange: (inputs: Input[]) => void }>) => {
	const { inputs, onInputsChange } = props;

	// On web, there's a global window event handler that captures the wheel event and prevents it
	// from being captured by the form div.
	// We need to stop the event propagation so we can actually scroll the form.
	// See https://github.com/posit-dev/positron/blob/58c02080130dc80e08fd319573e05a57073491aa/src/vs/workbench/services/auxiliaryWindow/browser/auxiliaryWindowService.ts#L135
	const handleWheel = (e: any) => {
		e.stopPropagation();
	};

	return <form className='create-connection-inputs' onWheel={handleWheel}>
		{
			inputs.map((input) => {
				return <FormElement key={input.id} input={input} onChange={(value) => {
					onInputsChange(
						inputs.map((i) => {
							if (i.id === input.id) {
								i.value = value;
							}
							return i;
						})
					);
				}}></FormElement>;
			})
		}
	</form>;
}

interface FormElementProps {
	input: Input;
	onChange: (value: string) => void;
}

/**
 * Determines whether to use a dropdown instead of radio buttons for option inputs.
 * Uses dropdown when:
 * - There are more than 3 options, OR
 * - Any option title exceeds 30 characters
 */
const shouldUseDropdown = (options: { identifier: string; title: string }[]): boolean => {
	const MAX_OPTIONS_FOR_RADIO = 3;
	const MAX_TITLE_LENGTH = 30;

	if (options.length > MAX_OPTIONS_FOR_RADIO) {
		return true;
	}

	return options.some(option => option.title.length > MAX_TITLE_LENGTH);
};

const FormElement = (props: PropsWithChildren<FormElementProps>) => {
	const { label, value: defaultValue = '', type, options } = props.input;

	switch (type) {
		case 'number':
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					type='text'
					value={defaultValue}
					onChange={(e) => props.onChange(e.target.value)}
				></LabeledTextInput>
			</div>;
		case 'option':
			if (!options || options.length === 0) {
				return <div className='labeled-input'><label className='label'>
					<span className='label-text'>{label}</span>
					<p>
						{(() => localize('positron.newConnectionModalDialog.createConnection.input.noOption', 'No options provided'))()}
					</p>
				</label></div>;
			}

			if (shouldUseDropdown(options)) {
				const entries = options.map(option => new DropDownListBoxItem({
					identifier: option.identifier,
					title: option.title,
					value: option.identifier
				}));

				return <div className='labeled-input'><label className='label'>
					<span className='label-text'>{label}</span>
					<DropDownListBox
						entries={entries}
						selectedIdentifier={defaultValue || options[0].identifier}
						title={label}
						onSelectionChanged={(item) => props.onChange(item.options.identifier)}
					/>
				</label></div>;
			}

			return <div className='labeled-input'><label className='label'>
				<span className='label-text'>{label}</span>
				<RadioGroup
					entries={options.map(option => ({ options: option }))}
					initialSelectionId={defaultValue || options[0].identifier}
					labelledBy={label}
					name={label}
					onSelectionChanged={(option) => props.onChange(option)}
				/>
			</label></div>;
		case 'string':
		default:
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					type='text'
					value={defaultValue}
					onChange={(e) => props.onChange(e.target.value)}
				></LabeledTextInput>
			</div>;
	}
};
