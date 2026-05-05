/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './footerButton.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { Button } from '../../../../../base/browser/ui/positronComponents/button/button.js';

/**
 * FooterButtonProps interface.
 */
interface FooterButtonProps {
	autoFocus?: boolean;
	default?: boolean;
	disabled?: boolean;
	onPressed: () => void;
}

/**
 * FooterButton component.
 * @param props A FooterButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const FooterButton = (props: PropsWithChildren<FooterButtonProps>) => {
	return (
		<Button
			autoFocus={props.autoFocus}
			className={positronClassNames(
				'footer-button',
				{ 'default': props.default }
			)}
			disabled={props.disabled}
			onPressed={props.onPressed}
		>
			{props.children}
		</Button>
	);
};
