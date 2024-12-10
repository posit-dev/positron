/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { PositronButton } from 'vs/base/browser/ui/positronComponents/button/positronButton';
import { localize } from 'vs/nls';
import { PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import 'vs/css!./createConnectionState';
import { SimpleCodeEditor, SimpleCodeEditorWidget } from 'vs/workbench/contrib/positronConnections/browser/components/simpleCodeEditor';
import Severity from 'vs/base/common/severity';
import { IDriver, Input, InputType } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsDriver';
import { LabeledTextInput } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/labeledTextInput';
import { RadioGroup } from 'vs/workbench/browser/positronComponents/positronModalDialog/components/radioGroup';
import { PositronModalReactRenderer } from 'vs/workbench/browser/positronModalReactRenderer/positronModalReactRenderer';

interface CreateConnectionProps {
	readonly services: PositronConnectionsServices;
	readonly renderer: PositronModalReactRenderer;
	readonly onCancel: () => void;
	readonly onBack: () => void;
	readonly selectedDriver: IDriver;
}

export const CreateConnection = (props: PropsWithChildren<CreateConnectionProps>) => {

	const { name, languageId, generateCode } = props.selectedDriver;
	const { onBack, onCancel, services } = props;
	const editorRef = useRef<SimpleCodeEditorWidget>(undefined!);

	const [inputs, setInputs] = useState<Array<Input>>(props.selectedDriver.inputs);
	const [code, setCode] = useState<string | undefined>(props.selectedDriver.generateCode?.(props.selectedDriver.inputs));

	useEffect(() => {
		// Debounce the code generation to avoid unnecessary re-renders
		const timeoutId = setTimeout(() => {
			if (generateCode) {
				const code = generateCode(inputs);
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
				props.selectedDriver.name
			),
			severity: Severity.Info
		});

		try {
			const connect = props.selectedDriver.connect;
			if (!connect) {
				throw new Error(
					localize('positron.newConnectionModalDialog.createConnection.connectNotImplemented', "Connect method not implemented")
				);
			}

			connect(code);
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
				{`${name} ${localize('positron.newConnectionModalDialog.createConnection.title', "Connection")}`}
			</h1>
		</div>

		<Form inputs={props.selectedDriver.inputs} onInputsChange={setInputs}></Form>

		<div className='create-connection-code-title'>
			{localize('positron.newConnectionModalDialog.createConnection.code', "Connection Code")}
		</div>

		<div className='create-connection-code-editor'>
			<SimpleCodeEditor
				ref={editorRef}
				services={props.services}
				language={languageId}
				editorOptions={{
					readOnly: true,
					cursorBlinking: 'solid'
				}}
				code={code}
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

	return <form className='create-connection-inputs'>
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
		case InputType.Number:
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					value={defaultValue}
					type='text'
					onChange={(e) => props.onChange(e.target.value)}
				></LabeledTextInput>
			</div>;
		case InputType.Option:
			return <div className='labeled-input'><label>
				<span className='label-text'>{label}</span>
				{
					options && options.length > 0 ?
						<RadioGroup
							name={label}
							labelledBy={label}
							entries={options.map(option => ({ options: option }))}
							initialSelectionId={options[0].identifier}
							onSelectionChanged={(option) => props.onChange(option)}
						/>
						: <p>
							{localize('positron.newConnectionModalDialog.createConnection.input.noOption', 'No options provided')}
						</p>
				}
			</label></div>;
		case InputType.String:
		default:
			return <div className='labeled-input'>
				<LabeledTextInput
					label={label}
					value={defaultValue}
					type='text'
					onChange={(e) => props.onChange(e.target.value)}
				></LabeledTextInput>
			</div>;
	}
};
