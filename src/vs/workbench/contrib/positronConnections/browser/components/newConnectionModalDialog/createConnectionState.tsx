/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './createConnectionState.css';

// React.
import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';

// Other dependencies.
import { PositronButton } from '../../../../../../base/browser/ui/positronComponents/button/positronButton.js';
import { localize } from '../../../../../../nls.js';
import { PositronConnectionsServices } from '../../positronConnectionsContext.js';
import { SimpleCodeEditor, SimpleCodeEditorWidget } from '../simpleCodeEditor.js';
import Severity from '../../../../../../base/common/severity.js';
import { IDriver, Input } from '../../../../../services/positronConnections/common/interfaces/positronConnectionsDriver.js';
import { LabeledTextInput } from '../../../../../browser/positronComponents/positronModalDialog/components/labeledTextInput.js';
import { RadioGroup } from '../../../../../browser/positronComponents/positronModalDialog/components/radioGroup.js';
import { PositronModalReactRenderer } from '../../../../../browser/positronModalReactRenderer/positronModalReactRenderer.js';

interface CreateConnectionProps {
	readonly services: PositronConnectionsServices;
	readonly renderer: PositronModalReactRenderer;
	readonly onCancel: () => void;
	readonly onBack: () => void;
	readonly selectedDriver: IDriver;
}

export const CreateConnection = (props: PropsWithChildren<CreateConnectionProps>) => {

	const { generateCode, metadata } = props.selectedDriver;
	const { name, languageId } = metadata;
	const { onBack, onCancel, services } = props;
	const editorRef = useRef<SimpleCodeEditorWidget>(undefined!);

	const [inputs, setInputs] = useState<Array<Input>>(metadata.inputs);
	const [code, setCode] = useState<string | undefined>(undefined);

	useEffect(() => {
		// Debounce the code generation to avoid unnecessary re-renders
		const timeoutId = setTimeout(async () => {
			if (generateCode) {
				const code = await generateCode(inputs);
				setCode(code);
			}
		}, 200);
		return () => clearTimeout(timeoutId);
	}, [inputs, generateCode, setCode]);

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

		const handle = services.connectionsService.notify(localize(
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

		<div className='create-connection-code-editor'>
			<SimpleCodeEditor
				ref={editorRef}
				code={code}
				editorOptions={{
					readOnly: true,
					cursorBlinking: 'solid'
				}}
				language={languageId}
				services={props.services}
			>
			</SimpleCodeEditor>
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
				className='button action-bar-button default'
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

	return <form onWheel={handleWheel} className='create-connection-inputs'>
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
			return <div className='labeled-input'><label className='label'>
				<span className='label-text'>{label}</span>
				{
					options && options.length > 0 ?
						<RadioGroup
							entries={options.map(option => ({ options: option }))}
							initialSelectionId={options[0].identifier}
							labelledBy={label}
							name={label}
							onSelectionChanged={(option) => props.onChange(option)}
						/>
						: <p>
							{(() => localize('positron.newConnectionModalDialog.createConnection.input.noOption', 'No options provided'))()}
						</p>
				}
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
