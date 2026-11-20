/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { countUnsavedInProject } from '../../../../services/positronCheckpoints/browser/unsavedEditorsGuard.js';
import { IWorkingCopyService } from '../../../../services/workingCopy/common/workingCopyService.js';
import { projectRootUri } from '../projectRoot.js';

/**
 * The number of files in the project with unsaved edits, kept current as editors change. An empty
 * `projectRoot` (the project is not known yet) counts as no files.
 */
export function useUnsavedCount(projectRoot: string): number {
	const services = usePositronReactServicesContext();
	const [count, setCount] = useState(0);

	useEffect(() => {
		if (projectRoot === '') {
			setCount(0);
			return undefined;
		}
		const workingCopyService = services.get(IWorkingCopyService);
		const { extUri } = services.get(IUriIdentityService);
		const root = projectRootUri(services.get(IWorkspaceContextService), projectRoot);
		const update = () => setCount(countUnsavedInProject(workingCopyService, extUri, root));

		const disposables = new DisposableStore();
		disposables.add(workingCopyService.onDidRegister(update));
		disposables.add(workingCopyService.onDidUnregister(update));
		disposables.add(workingCopyService.onDidChangeDirty(update));
		update();
		return () => disposables.dispose();
	}, [services, projectRoot]);

	return count;
}
