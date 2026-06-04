/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './controlGallery.css';

// React.
import { useState } from 'react';

// Other dependencies.
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { controlGalleryRegistry } from '../controlGalleryRegistry.js';

/**
 * ControlGallery component. Renders a left-hand navigation list of registered gallery entries
 * and a right-hand panel showing the selected entry's harness. The set of entries is read once
 * at mount time; harnesses self-register via side-effect imports from the contribution file's
 * barrel, so the registry is fully populated by the time this component renders.
 */
export const ControlGallery = () => {
	const entries = controlGalleryRegistry.getEntries();
	const [selectedId, setSelectedId] = useState(() => entries[0]?.id);

	const selectedEntry = entries.find(entry => entry.id === selectedId);

	return (
		<div className='control-gallery'>
			<div className='control-gallery-body'>
				<nav aria-label='Controls' className='control-gallery-nav'>
					<ul>
						{entries.map(entry => (
							<li key={entry.id}>
								<button
									className={positronClassNames(
										'control-gallery-nav-item',
										{ 'selected': entry.id === selectedId }
									)}
									type='button'
									onClick={() => setSelectedId(entry.id)}
								>
									<span className='control-gallery-nav-label'>{entry.label}</span>
									{entry.description && (
										<span className='control-gallery-nav-description'>{entry.description}</span>
									)}
								</button>
							</li>
						))}
					</ul>
				</nav>
				<section className='control-gallery-panel'>
					{selectedEntry ? selectedEntry.render() : (
						<div className='control-gallery-empty'>No controls registered.</div>
					)}
				</section>
			</div>
			{/*
				A 1 CSS pixel buffer at the bottom so the editor's bottom chrome (which paints
				over the last pixel of the editor's content area) does not eat into the nav or
				the harness inside the panel.
			*/}
			<div className='control-gallery-editor-chrome-buffer' />
		</div>
	);
};
