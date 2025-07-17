/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { usePositronReactServicesContext } from '../../positronReactRendererContext.js';

interface ExternalLinkProps extends React.ComponentPropsWithoutRef<'a'> {
}

/**
 * Special link that opens in the opener service. Used to make links that behave like normal links
 * while in the UI/React layer.
 * @param props The props for the link with the opener service added.
 * @returns The rendered link component that opens in the opener service.
 */
export function ExternalLink(props: ExternalLinkProps) {
	// Context hooks.
	const services = usePositronReactServicesContext();

	const { href, ...otherProps } = props;

	return <a
		{...otherProps}
		href={href}
		onClick={(e) => {
			if (!href) {
				return;
			}
			e.preventDefault();
			services.openerService.open(href);
		}}
	>
		{props.children}
	</a>
		;
}
