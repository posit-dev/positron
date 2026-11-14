/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './dataConnectionConfirmation.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronModalReactRenderer } from '../../../../../base/browser/positronModalReactRenderer.js';
import { TwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/twoButtonFooter.js';
import { DestructiveTwoButtonFooter } from '../../../../browser/positronComponents/positronDynamicModalDialog/components/destructiveTwoButtonFooter.js';
import { PositronDynamicModalDialog } from '../../../../browser/positronComponents/positronDynamicModalDialog/positronDynamicModalDialog.js';

// The width of a Data Connections confirmation dialog.
const DATA_CONNECTION_CONFIRMATION_WIDTH = 460;

/**
 * The options for a Data Connections confirmation dialog.
 */
export interface DataConnectionConfirmationOptions {
	/** The title shown in the dialog's title bar. */
	readonly title: string;
	/** The paragraphs of the dialog's body. Undefined entries are left out. */
	readonly details: ReadonlyArray<string | undefined>;
	/** The title of the confirming button. */
	readonly confirmButtonTitle: string;
	/** Whether the confirming action cannot be undone. Styles the confirming button red. */
	readonly destructive?: boolean;
}

/**
 * Shows a Data Connections confirmation dialog.
 * @param options The dialog's title, body, and confirming button.
 * @returns A promise that resolves to true if the user confirmed, or false if they cancelled or
 * the dialog was closed some other way.
 */
export function showDataConnectionConfirmation(options: DataConnectionConfirmationOptions): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		// Confirm, Cancel, the title bar's close button, and Escape each call settle, which resolves
		// the promise and disposes the renderer. The guard stops a second call from disposing again.
		let settled = false;
		const settle = (confirmed: boolean) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(confirmed);
			renderer.dispose();
		};

		// When something else disposes the renderer, such as a parent modal closing, resolve
		// without disposing again: the renderer is already part way through its own dispose.
		const renderer = new PositronModalReactRenderer({
			onDisposed: () => {
				settled = true;
				resolve(false);
			}
		});

		const footerProps = {
			primaryButtonTitle: options.confirmButtonTitle,
			secondaryButtonTitle: localize('positron.dataConnectionConfirmation.cancel', "Cancel"),
			onPrimaryButton: () => settle(true),
			onSecondaryButton: () => settle(false),
		};

		renderer.render(
			<PositronDynamicModalDialog
				content={
					<div className='data-connection-confirmation'>
						{options.details
							.filter(detail => detail !== undefined)
							.map((detail, index) => <div key={index}>{detail}</div>)}
					</div>
				}
				footer={options.destructive
					? <DestructiveTwoButtonFooter {...footerProps} />
					: <TwoButtonFooter {...footerProps} />
				}
				renderer={renderer}
				title={options.title}
				width={DATA_CONNECTION_CONFIRMATION_WIDTH}
				onCancel={() => settle(false)}
			/>
		);
	});
}

/**
 * Gets the paragraph that tells the user how many Data Explorers previewed from a connection
 * will close.
 * @param openDataExplorerCount How many Data Explorers previewed from the connection are open.
 * @returns The paragraph, or undefined when no Data Explorers are open.
 */
export function dataExplorersClosingDetail(openDataExplorerCount: number): string | undefined {
	// Named separately per count, since localized strings cannot select a plural form from a
	// placeholder.
	if (openDataExplorerCount === 1) {
		return localize(
			'positron.dataConnectionConfirmation.oneDataExplorer',
			"The Data Explorer open on this connection will close."
		);
	}
	if (openDataExplorerCount > 1) {
		return localize(
			'positron.dataConnectionConfirmation.manyDataExplorers',
			"The {0} Data Explorers open on this connection will close.",
			openDataExplorerCount
		);
	}
	return undefined;
}
