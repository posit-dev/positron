/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editableCodeEditor.css';

// React.
import { Ref, useEffect, useImperativeHandle, useRef } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { getSimpleCodeEditorWidgetOptions, getSimpleEditorOptions } from '../../../contrib/codeEditor/browser/simpleEditorOptions.js';

/**
 * EditableCodeEditorProps interface.
 */
export interface EditableCodeEditorProps {
	readonly ariaLabel?: string;
	readonly code: string;
	readonly languageId: string;
	readonly ref: Ref<EditableCodeEditorWidget>;
}

/**
 * The imperative handle exposed by {@link EditableCodeEditor}. Callers read the editor's current
 * code through this rather than tracking the buffer in React state.
 */
export interface EditableCodeEditorWidget {
	getCode(): string;
}

/**
 * Editable Code Editor component. Renders an always-editable Monaco editor seeded with the given
 * code and language, which are fixed for the lifetime of the component. Callers read the live
 * buffer via the imperative handle's getCode(); to show different code, mount a fresh instance
 * with a distinct `key`.
 */
export const EditableCodeEditor = (props: EditableCodeEditorProps) => {
	// Get services.
	const services = usePositronReactServicesContext();

	// Destructure props.
	const { ariaLabel, code, languageId, ref } = props;

	// The element the editor is mounted into. React populates this before the effect below runs,
	// so the non-null assertion is safe.
	const containerRef = useRef<HTMLDivElement>(undefined!);

	// The live editor instance. Undefined until the effect creates it (and again after the effect
	// cleanup disposes it), so the handle guards its reads.
	const editorRef = useRef<CodeEditorWidget | undefined>(undefined);

	// Expose a narrow handle on the forwarded ref so callers can read the live buffer without
	// re-rendering. Built once ([] deps); it reads editorRef lazily, so it always sees the current
	// editor even after a recreate, and falls back to '' before the editor exists or after disposal.
	useImperativeHandle(ref, () => ({
		getCode: () => editorRef.current?.getValue() ?? '',
	}), []);

	// Create the editor (and its model) on mount and dispose them on unmount. `code` and
	// `languageId` are fixed for the component's lifetime, so this runs once; callers remount via
	// `key` to show different code.
	useEffect(() => {
		// Create disposables store to track the editor and its model.
		const disposableStore = new DisposableStore();

		// Create the editor.
		const editor = disposableStore.add(services.instantiationService.createInstance(
			CodeEditorWidget,
			containerRef.current,
			{
				...getSimpleEditorOptions(services.configurationService),
				// The name a screen reader announces for the editor. Left undefined, Monaco falls
				// back to its generic 'Editor content'.
				ariaLabel,
				// The editable code editor is, as the name says, always editable.
				readOnly: false,
				domReadOnly: false,
				// Tab moves focus to the next control instead of inserting indentation, matching what
				// VS Code does for editors embedded in a widget (chat code blocks, tool
				// confirmations). This editor is used inside modal dialogs, whose renderer
				// suppresses all but a handful of keybindings, so toggleTabFocusMode is not
				// available as an escape hatch. Without this, a keyboard-only user cannot Tab past
				// the editor to reach the dialog's buttons.
				tabFocusMode: true,
				// Vertical breathing room lives inside the editor (rather than as container padding)
				// so the vertical scrollbar can span the full height of the code box.
				padding: { top: 10, bottom: 10 },
				// A slightly thinner vertical scrollbar than the 14px default.
				scrollbar: { verticalScrollbarSize: 10 },
			},
			getSimpleCodeEditorWidgetOptions()
		));

		// Create and set the model.
		//
		// Creating a model in a language is what Positron reads as "a file in that language was
		// opened", so previewing R code in a window that has never seen R implicitly starts an R
		// session. Let's suppress that.
		const suppressed = services.runtimeSessionService.implicitStartupSuppressed;
		services.runtimeSessionService.implicitStartupSuppressed = true;
		try {
			editor.setModel(disposableStore.add(services.modelService.createModel(
				code,
				services.languageService.createById(languageId),
				undefined,
				true
			)));
		} finally {
			// Restore in a finally: leaving the flag set because model creation threw would disable
			// auto-start for the rest of the window's life.
			services.runtimeSessionService.implicitStartupSuppressed = suppressed;
		}

		// Track the editor instance in a ref for the imperative handle.
		editorRef.current = editor;

		// Dispose editor and model on unmount.
		return () => disposableStore.dispose();

		// Deps intentionally empty: ariaLabel/code/languageId/services are fixed for a given
		// instance, so the editor is created once. Callers remount via `key` to show different code.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Render the container for the editor.
	return <div ref={containerRef} className='editable-code-editor' />;
};
