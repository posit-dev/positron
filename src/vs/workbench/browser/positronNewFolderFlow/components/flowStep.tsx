/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './flowStep.css';

// React.
import { PropsWithChildren, createContext, useContext } from 'react';

// Other dependencies.
import { localize } from '../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { VerticalStack } from '../../positronComponents/positronModalDialog/components/verticalStack.js';
import { ActionBarButtonConfig, OKCancelBackNextActionBarProps } from '../../positronComponents/positronModalDialog/components/okCancelBackNextActionBar.js';
import { FooterButton } from '../../positronComponents/positronDynamicModalDialog/components/footerButton.js';
import { PositronDynamicModalDialog } from '../../positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

/**
 * The dialog each flow step renders into. Every step is its own dynamic modal dialog, sized to its
 * content, so a step that grows (a callout appearing, a long path) grows the dialog instead of
 * overflowing a fixed height.
 */
export interface FlowDialog {
	renderer: PositronModalReactRenderer;
	width: number;
	onCancel: () => void;
}

const FlowDialogContext = createContext<FlowDialog | undefined>(undefined);

/**
 * Provides the dialog that the flow's steps render into.
 */
export const FlowDialogProvider = (props: PropsWithChildren<{ dialog: FlowDialog }>) => (
	<FlowDialogContext.Provider value={props.dialog}>
		{props.children}
	</FlowDialogContext.Provider>
);

/**
 * PositronFlowStepProps interface.
 */
export interface PositronFlowStepProps extends OKCancelBackNextActionBarProps {
	title: string;
	/** An id for the title element, for a control inside the step to name itself by. */
	titleId?: string;
}

/**
 * PositronFlowStep component.
 * @param props A PropsWithChildren<PositronFlowStepProps> that contains the component properties.
 * @returns The rendered component.
 */
export const PositronFlowStep = (props: PropsWithChildren<PositronFlowStepProps>) => {
	const dialog = useContext(FlowDialogContext);
	if (!dialog) {
		throw new Error('PositronFlowStep must be rendered inside a FlowDialogProvider');
	}

	// The step ID is based on the title, with non-letter or non-number characters replaced with hyphens.
	const stepId = props.title.toLowerCase().replace(/[^a-z0-9]/g, '-') || '';

	// Render.
	return (
		<PositronDynamicModalDialog
			content={
				<div
					className='flow-step'
					id={stepId.length ? `flow-step-${stepId}` : ''}
				>
					{/* The step's name shows in the title bar. This copy is hidden and only gives */}
					{/* controls in the step something to be named by. */}
					{props.titleId && <span hidden id={props.titleId}>{props.title}</span>}
					<VerticalStack>{props.children}</VerticalStack>
				</div>
			}
			footer={
				<FlowStepFooter
					backButtonConfig={props.backButtonConfig}
					cancelButtonConfig={props.cancelButtonConfig}
					nextButtonConfig={props.nextButtonConfig}
					okButtonConfig={props.okButtonConfig}
				/>
			}
			renderer={dialog.renderer}
			// The step's name is the dialog's title: one line that says where the user is.
			title={props.title}
			width={dialog.width}
			onCancel={dialog.onCancel}
		/>
	);
};

/**
 * The flow step's footer: Back on the left, Next or OK on the right. There is no Cancel button:
 * the title bar's close button and Escape cancel the flow. Built from FooterButton rather than
 * ThreeButtonFooter, which cannot disable its primary button, and Next and Create stay disabled
 * until the step is complete.
 */
const FlowStepFooter = (props: OKCancelBackNextActionBarProps) => {
	const renderButton = (config: ActionBarButtonConfig | undefined, defaultTitle: string, primary: boolean) => {
		if (!config) {
			return null;
		}
		return (
			<FooterButton
				default={primary}
				disabled={(config.disable ?? false) || (config.loading ?? false)}
				// The primary button is the form's submit button, so Enter presses it.
				type={primary ? 'submit' : 'button'}
				onPressed={() => config.onClick?.()}
			>
				{config.loading && <span aria-hidden='true' className='codicon codicon-loading codicon-modifier-spin' />}
				{config.title ?? defaultTitle}
			</FooterButton>
		);
	};

	return (
		<div className='flow-step-footer'>
			<div className='flow-step-footer-left'>
				{renderButton(props.backButtonConfig, localize('positronBack', "Back"), false)}
			</div>
			<div className='flow-step-footer-right'>
				{props.okButtonConfig ?
					renderButton(props.okButtonConfig, localize('positronOK', "OK"), true) :
					renderButton(props.nextButtonConfig, localize('positronNext', "Next"), true)
				}
			</div>
		</div>
	);
};
