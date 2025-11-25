/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

interface NotebookLinkProps extends React.ComponentPropsWithoutRef<'a'> {
}

/**
 * Link component for notebook markdown cells that handles anchor links by letting
 * the browser handle them with default behavior. For other links, it delegates to
 * the opener service like ExternalLink does.
 *
 * @param props The props for the link component.
 * @returns The rendered link component.
 */
export function NotebookLink(props: NotebookLinkProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();

	const { href, ...otherProps } = props;

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (!href) {
			return;
		}

		const isAnchorLink = href.trim().startsWith('#');

		// For anchor links, let browser handle with default behavior
		if (isAnchorLink) {
			return;
		}

		// For other links, use opener service
		e.preventDefault();
		services.openerService.open(href);
	};

	return <a
		{...otherProps}
		href={href}
		onClick={handleClick}
	>
		{props.children}
	</a>;
}

