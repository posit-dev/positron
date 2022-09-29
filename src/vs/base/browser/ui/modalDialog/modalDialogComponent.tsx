/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./modalDialogComponent';
const React = require('react');

/**
 * ModalDialogComponent component.
 * @param props The properties.
 */
export const ModalDialogComponent = (props: { children: React.ReactNode }) => {
	// Render.
	return (
		<div className='monaco-modal-dialog-shadow-container'>
			<div className='monaco-modal-dialog-box' role='dialog' tabIndex={-1}>
				<div className='monaco-modal-dialog-box-frame'>
					{props.children}
				</div>
			</div>
		</div>
	);
};

// Export the ModalDialogComponent component.
export default ModalDialogComponent;
