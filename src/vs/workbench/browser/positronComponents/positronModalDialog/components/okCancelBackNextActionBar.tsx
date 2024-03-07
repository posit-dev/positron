/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./OKCancelBackNextActionBar';
import * as React from 'react';
import { localize } from 'vs/nls';

/**
 * OKCancelBackNextActionBarProps interface.
 */
interface OKCancelBackNextActionBarProps {
	okButtonTitle?: string;
	cancelButtonTitle?: string;
	backButtonTitle?: string;
	nextButtonTitle?: string;
	hideOkButton?: boolean;
	hideCancelButton?: boolean;
	hideBackButton?: boolean;
	hideNextButton?: boolean;
	accept: () => void;
	cancel: () => void;
	back: () => void;
	next: () => void;
}

/**
 * OKCancelBackNextActionBar component.
 * @param props An OKCancelBackNextActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const OKCancelBackNextActionBar = (props: OKCancelBackNextActionBarProps) => {
	// Render.
	return (
		<div className='ok-cancel-action-bar top-separator'>
			<div className='left-actions'>
				{!props.hideBackButton && (
					<button className='button action-bar-button' tabIndex={0} onClick={props.back}>
						{props.backButtonTitle ?? localize('positronBack', "Back")}
					</button>
				)}
			</div>
			<div className='right-actions'>
				{!props.hideCancelButton && (
					<button className='button action-bar-button' tabIndex={0} onClick={props.cancel}>
						{props.cancelButtonTitle ?? localize('positronCancel', "Cancel")}
					</button>
				)}
				{!props.hideOkButton && (
					<button className='button action-bar-button default' tabIndex={0} onClick={props.accept}>
						{props.okButtonTitle ?? localize('positronOK', "OK")}
					</button>
				)}
				{!props.hideNextButton && (
					<button className='button action-bar-button default' tabIndex={0} onClick={props.next}>
						{props.nextButtonTitle ?? localize('positronNext', "Next")}
					</button>
				)}
			</div>
		</div>
	);
};
