/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';

const showPreviousPreview = localize('positron.preview.previous', "Show Previous Viewer Item");
const showNextPreview = localize('positron.preview.next', "Show Next Viewer Item");

/**
 * Buttons for navigating between the outputs in the Viewer history.
 */
export const PreviewHistoryActions = () => {
	const services = usePositronReactServicesContext();

	return (
		<>
			<ActionBarButton
				ariaLabel={showPreviousPreview}
				disabled={!services.positronPreviewService.canSelectPreviousPreview}
				icon={ThemeIcon.fromId('positron-left-arrow')}
				tooltip={showPreviousPreview}
				onPressed={() => services.positronPreviewService.selectPreviousPreview()}
			/>
			<ActionBarButton
				ariaLabel={showNextPreview}
				disabled={!services.positronPreviewService.canSelectNextPreview}
				icon={ThemeIcon.fromId('positron-right-arrow')}
				tooltip={showNextPreview}
				onPressed={() => services.positronPreviewService.selectNextPreview()}
			/>
		</>
	);
};
