/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EmbeddedLink } from '../../../../../base/browser/ui/positronComponents/embeddedLink/EmbeddedLink.js';

interface ErrorMessageWithLinksProps {
	message: string;
	onLinkClick?: () => void;
}

/**
 * Component that renders an error message with support for markdown-style command links.
 * Parses links like [text](command:id?args) and makes them clickable.
 * Also handles newlines properly by converting them to <br /> elements.
 */
export const ErrorMessageWithLinks = ({ message, onLinkClick }: ErrorMessageWithLinksProps) => {
	return <div className='language-model-error error error-msg'>
		<EmbeddedLink onLinkClick={onLinkClick}>{message}</EmbeddedLink>
	</div>;
};
