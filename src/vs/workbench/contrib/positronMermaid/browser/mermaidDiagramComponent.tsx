/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './mermaidDiagram.css';

import React from 'react';
import { localize } from '../../../../nls.js';
import { isDark } from '../../../../platform/theme/common/theme.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';
import { createTrustedTypesPolicy } from '../../../../base/browser/trustedTypes.js';
import { IMermaidRenderService, MermaidTheme } from './mermaidRenderService.js';

// Trusted Types policy for CSP compliance. The SVG is rendered in our own
// sandboxed webview with securityLevel:'strict' and sanitized there (script
// elements, on* handlers, javascript: URLs stripped) before being posted back.
const trustedSvgPolicy = createTrustedTypesPolicy('positronMermaid', {
	createHTML: (value: string) => value,
});

interface MermaidDiagramProps {
	readonly source: string;
	readonly onDoubleClick?: () => void;
	readonly onFocus?: () => void;
}

export function MermaidDiagram({ source, onDoubleClick, onFocus }: MermaidDiagramProps) {
	const services = usePositronReactServicesContext();
	const mermaidService = services.get(IMermaidRenderService);
	const themeService = services.get(IThemeService);

	const getMermaidTheme = React.useCallback(
		(): MermaidTheme => isDark(themeService.getColorTheme().type) ? 'dark' : 'default',
		[themeService]
	);

	const [theme, setTheme] = React.useState(getMermaidTheme);
	const [svg, setSvg] = React.useState<string>();
	const [error, setError] = React.useState<string>();
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const disposable = themeService.onDidColorThemeChange(() => {
			setTheme(getMermaidTheme());
		});
		return () => disposable.dispose();
	}, [themeService, getMermaidTheme]);

	React.useEffect(() => {
		let cancelled = false;

		setSvg(undefined);
		setError(undefined);

		mermaidService.render(source, theme).then(
			(result) => {
				if (!cancelled) {
					setSvg(result);
				}
			},
			(err) => {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		);

		return () => { cancelled = true; };
	}, [mermaidService, source, theme]);

	React.useEffect(() => {
		const container = containerRef.current;
		if (container && svg) {
			if (trustedSvgPolicy) {
				container.innerHTML = trustedSvgPolicy.createHTML(svg) as unknown as string;
			} else {
				container.innerHTML = svg;
			}
		}
	}, [svg]);

	if (error) {
		return (
			<div className='mermaid-diagram-error'>
				{localize('positron.mermaid.error', "Error rendering diagram: {0}", error)}
			</div>
		);
	}

	if (!svg) {
		return (
			<div className='mermaid-diagram-loading'>
				{localize('positron.mermaid.rendering', "Rendering diagram...")}
			</div>
		);
	}

	return (
		<div
			ref={containerRef}
			aria-label={localize('positron.mermaid.diagramLabel', "Mermaid diagram")}
			className='mermaid-diagram-container'
			role='img'
			tabIndex={0}
			onDoubleClick={onDoubleClick}
			onFocus={onFocus}
		/>
	);
}
