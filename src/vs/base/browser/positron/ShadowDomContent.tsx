/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useRef } from 'react';

interface ShadowDomContentProps {
	content: string;
	/**
	 * Trusted Types policy that vouches for `content` before it is assigned to
	 * the shadow root. Owned by the caller so the trust decision (and its CSP
	 * trusted-types allowlist entry) stays with the code that knows the content
	 * is safe. May be undefined where Trusted Types is unavailable, in which case
	 * the string is assigned directly.
	 */
	trustedTypesPolicy: Pick<TrustedTypePolicy, 'createHTML'> | undefined;
}

/**
 * Renders an HTML string inside a shadow root, isolating it from the surrounding
 * document: the content's styles do not leak out, and document styles do not
 * leak in. Useful for HTML that ships its own styles or is a full document
 * (e.g. Great Tables output).
 *
 * The content is isolated by a shadow root; assigning to its innerHTML also
 * unwraps document tags (<!doctype>/<html>/<body>) that renderHtml cannot render
 * inline.
 */
export function ShadowDomContent({ content, trustedTypesPolicy }: ShadowDomContentProps) {
	const hostRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) {
			return;
		}

		if (!host.shadowRoot) {
			host.attachShadow({ mode: 'open' });
		}
		const shadow = host.shadowRoot!;
		shadow.innerHTML = (trustedTypesPolicy?.createHTML(content) || content) as string;

		return () => {
			host.shadowRoot?.replaceChildren();
		};
	}, [content, trustedTypesPolicy]);

	return <div ref={hostRef} />;
}
