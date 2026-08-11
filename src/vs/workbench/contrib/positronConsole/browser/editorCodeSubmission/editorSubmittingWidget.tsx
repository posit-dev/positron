/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './editorSubmittingWidget.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import * as DOM from '../../../../../base/browser/dom.js';
import { localize } from '../../../../../nls.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { PositronModalPopup } from '../../../../browser/positronComponents/positronModalPopup/positronModalPopup.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IActiveCodeSubmission, IEditorCodeSubmissionService } from './editorCodeSubmissionService.js';

/**
 * EditorSubmittingWidgetMount props.
 */
export interface EditorSubmittingWidgetMountProps {
	readonly accessor: ServicesAccessor;
}

/**
 * Action-bar widget shown while code submitted from the editor is being prepared
 * for execution and the statement range provider is taking a while to respond.
 *
 * It mirrors the console's "Submitting..." overlay: a small "Submitting" pill
 * appears in the editor action bar; clicking it opens a dialog that offers to
 * cancel the submission or run the code as-is.
 *
 * The widget is always mounted (the action bar re-renders only on active-editor,
 * menu, and theme changes, not on arbitrary state changes), so it subscribes to
 * the submission service and renders nothing until a submission crosses the
 * widget threshold for the active editor.
 */
export function EditorSubmittingWidgetMount({ accessor }: EditorSubmittingWidgetMountProps) {
	// Services.
	const services = usePositronReactServicesContext();
	const submissionService = accessor.get(IEditorCodeSubmissionService);
	const editorService = accessor.get(IEditorService);

	// The anchor element for the dialog popup.
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

	// The renderer for the currently open dialog, if any. Tracked so the dialog
	// can be torn down if the pill unmounts; otherwise an unmount (e.g. the
	// submission finishing) would orphan a popup anchored to a detached button.
	const rendererRef = useRef<PositronModalReactRenderer | undefined>(undefined);

	const [submission, setSubmission] = useState<IActiveCodeSubmission | undefined>(
		() => submissionService.activeSubmission);
	const [activeResource, setActiveResource] = useState(() => editorService.activeEditor?.resource);

	// Track the active submission.
	useEffect(() => {
		const disposable = submissionService.onDidChangeState(() => {
			setSubmission(submissionService.activeSubmission);
		});
		return () => disposable.dispose();
	}, [submissionService]);

	// Track the active editor's resource.
	useEffect(() => {
		const disposable = editorService.onDidActiveEditorChange(() => {
			setActiveResource(editorService.activeEditor?.resource);
		});
		return () => disposable.dispose();
	}, [editorService]);

	// Tear down any open dialog when the pill unmounts.
	useEffect(() => () => {
		rendererRef.current?.dispose();
		rendererRef.current = undefined;
	}, []);

	// Render nothing unless a submission is in progress for the active editor.
	if (!submission || submission.uri.toString() !== activeResource?.toString()) {
		return null;
	}

	const label = localize('positron.editorSubmitting.label', "Submitting");

	// Open the dialog popup anchored to the pill, offering to cancel or run as-is.
	const showDialog = () => {
		if (!buttonRef.current) {
			return;
		}

		const renderer = new PositronModalReactRenderer({
			container: services.workbenchLayoutService.getContainer(DOM.getWindow(buttonRef.current)),
			parent: buttonRef.current,
			onDisposed: () => { rendererRef.current = undefined; },
		});
		rendererRef.current = renderer;

		renderer.render(
			<EditorSubmittingDialog
				anchorElement={buttonRef.current}
				line={submission.line}
				renderer={renderer}
				submissionService={submissionService}
			/>
		);
	};

	return (
		<button
			ref={buttonRef}
			aria-haspopup='dialog'
			aria-label={label}
			className='editor-submitting-badge'
			data-testid='editor-submitting-badge'
			title={label}
			onClick={showDialog}
		>
			<span className='codicon codicon-arrow-right'></span>
			<span className='editor-submitting-label'>{label}</span>
			<span className='codicon codicon-positron-drop-down-arrow'></span>
		</button>
	);
}

/**
 * EditorSubmittingDialog props.
 */
interface EditorSubmittingDialogProps {
	readonly anchorElement: HTMLElement;
	readonly renderer: PositronModalReactRenderer;
	readonly line: number;
	readonly submissionService: IEditorCodeSubmissionService;
}

/**
 * A dialog popup shown while a slow statement range detection is in progress. It
 * names the line whose statement is being detected and offers to cancel the
 * submission or run the code as-is.
 */
const EditorSubmittingDialog = (props: EditorSubmittingDialogProps) => {
	const { line, renderer, submissionService } = props;

	// Close the dialog if the submission finishes on its own (the provider
	// responded), so it does not linger anchored to a pill that is going away.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(submissionService.onDidChangeState(() => {
			if (!submissionService.activeSubmission) {
				renderer.dispose();
			}
		}));
		return () => disposableStore.dispose();
	}, [submissionService, renderer]);

	const cancel = () => {
		renderer.dispose();
		submissionService.cancel();
	};

	const runAsIs = () => {
		renderer.dispose();
		submissionService.runAsIs();
	};

	return (
		<PositronModalPopup
			anchorElement={props.anchorElement}
			height='auto'
			keyboardNavigationStyle='dialog'
			popupAlignment='right'
			popupPosition='bottom'
			renderer={renderer}
			width={320}
		>
			<div className='editor-submitting-dialog'>
				<div className='editor-submitting-dialog-message'>
					{localize(
						'positron.editorSubmitting.dialogMessage',
						"Positron is detecting the code to submit at line {0}.",
						line
					)}
				</div>
				<div className='editor-submitting-dialog-actions'>
					<Button className='editor-submitting-dialog-button' onPressed={cancel}>
						{localize('positron.editorSubmitting.cancel', "Cancel")}
					</Button>
					<Button className='editor-submitting-dialog-button default' onPressed={runAsIs}>
						{localize('positron.editorSubmitting.runAsIs', "Run as Is")}
					</Button>
				</div>
			</div>
		</PositronModalPopup>
	);
};
