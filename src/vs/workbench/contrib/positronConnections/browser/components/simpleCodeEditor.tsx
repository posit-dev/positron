/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { forwardRef, PropsWithChildren, useEffect, useImperativeHandle, useRef } from 'react';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { IIdentifiedSingleEditOperation, ITextModel } from '../../../../../editor/common/model.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../../codeEditor/browser/simpleEditorOptions.js';
import { PositronConnectionsServices } from '../positronConnectionsContext.js';

export interface SimpleCodeEditorProps {
	readonly services: PositronConnectionsServices;
	readonly code?: string;
	readonly language?: string;
	readonly editorOptions?: IEditorOptions;
}

export interface SimpleCodeEditorWidget {
	getValue: () => string;
	setValue(value: string): void;
	updateOptions: (options: IEditorOptions) => void;
	setScrollTop: (newScrollTop: number) => void;
	focus: () => void;
	getModel(): ITextModel | null;
	executeEdits: (source: string, edits: IIdentifiedSingleEditOperation[]) => boolean;
}

/**
 * Simple Code Editor component
 * Ideally, you should not re-render it, but instead modify it's attributes
 * by calling the methods of the CodeEditorWidget instance.
 */
export const SimpleCodeEditor = forwardRef<
	SimpleCodeEditorWidget,
	PropsWithChildren<SimpleCodeEditorProps>
>((props, ref) => {
	const editorContainerRef = useRef<HTMLDivElement>(undefined!);
	const editorRef = useRef<CodeEditorWidget>(undefined!);

	useImperativeHandle(ref, () => ({
		getValue: () => editorRef.current.getValue(),
		setValue: (value) => editorRef.current.setValue(value),
		updateOptions: (options: IEditorOptions) => editorRef.current.updateOptions(options),
		setScrollTop: (newScrollTop) => editorRef.current.setScrollTop(newScrollTop),
		focus: () => editorRef.current.focus(),
		getModel: () => editorRef.current.getModel(),
		executeEdits: (source, edits) => editorRef.current.executeEdits(source, edits)
	}));

	const { code, language, services, editorOptions } = props;

	useEffect(() => {
		const disposableStore = new DisposableStore();
		const editor = disposableStore.add(services.instantiationService.createInstance(
			CodeEditorWidget,
			editorContainerRef.current,
			{
				...getSimpleEditorOptions(services.configurationService),
				...editorOptions
			},
			getSimpleCodeEditorWidgetOptions()
		));

		const emitter = disposableStore.add(new Emitter<string>);
		const inputModel = disposableStore.add(services.modelService.createModel(
			code || '',
			{ languageId: language || '', onDidChange: emitter.event },
			undefined,
			true
		));

		editor.setModel(inputModel);
		editorRef.current = editor;

		return () => {
			disposableStore.dispose();
		};
	},
		[
			code, language, editorOptions, ref,
			services.instantiationService,
			services.configurationService,
			editorContainerRef,
			services.modelService,
		]);

	return <div ref={editorContainerRef} style={{ height: '100%' }}></div>;
});

SimpleCodeEditor.displayName = 'SimpleCodeEditor';
