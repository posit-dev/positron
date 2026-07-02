/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IMissingPackagesService } from '../common/missingPackagesService.js';
import { MissingPackagesBadge } from './missingPackagesBadge.js';

export interface MissingPackagesBadgeMountProps {
	readonly accessor: ServicesAccessor;
}

/**
 * Action-bar mount for {@link MissingPackagesBadge}. Tracks the active editor's
 * resource and feeds it to the badge. Registered for both the editor action bar
 * (script / quarto documents) and the Positron notebook toolbar; the `when`
 * clause on each registration scopes where it appears.
 */
export function MissingPackagesBadgeMount({ accessor }: MissingPackagesBadgeMountProps) {
	const editorService = accessor.get(IEditorService);
	const missingPackagesService = accessor.get(IMissingPackagesService);
	const configurationService = accessor.get(IConfigurationService);

	const [resource, setResource] = useState<URI | undefined>(() => editorService.activeEditor?.resource);

	useEffect(() => {
		const disposable = editorService.onDidActiveEditorChange(() => {
			setResource(editorService.activeEditor?.resource);
		});
		return () => disposable.dispose();
	}, [editorService]);

	return (
		<MissingPackagesBadge
			configurationService={configurationService}
			missingPackagesService={missingPackagesService}
			resource={resource}
		/>
	);
}
