/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './providerConfigContent.css';

// SPIKE (#14695): minimal, chrome-agnostic content component. It takes its data via props (a plain
// view model, not workbench services) so it can be mounted unchanged by EITHER the modal renderer
// (PositronModalReactRenderer) or the editor renderer (PositronReactRenderer) -- this is the reuse
// property the spike demonstrates. The host pane owns the service wiring and maps into this shape;
// the real redesign content (#14815) would slot in here the same way.

export interface ProviderSummary {
	readonly id: string;
	readonly displayName: string;
	readonly connected: boolean;
}

export interface ProviderConfigContentProps {
	readonly providers: readonly ProviderSummary[];
}

export const ProviderConfigContent = (props: ProviderConfigContentProps) => {
	return (
		<div className='provider-config-content' data-testid='provider-config-content'>
			<h1 className='provider-config-content-title'>Configure LLM Providers</h1>
			<p className='provider-config-content-subtitle'>
				Spike (#14695): this React tree is hosted inside a workbench editor rendered as a
				modal overlay via the upstream modal editor part.
			</p>
			{props.providers.length === 0
				? <p className='provider-config-content-empty'>No providers are currently enabled.</p>
				: <ul className='provider-config-content-list'>
					{props.providers.map(provider =>
						<li key={provider.id} className='provider-config-content-item'>
							<span className='provider-config-content-name'>{provider.displayName}</span>
							<span className='provider-config-content-status'>
								{provider.connected ? 'Connected' : 'Not connected'}
							</span>
						</li>
					)}
				</ul>
			}
		</div>
	);
};
