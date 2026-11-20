/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PathPlan } from './journal';
import { EnginePorts } from './ports';
import { PathCollision } from './types';

/**
 * Lists the paths of `paths` that would replace a file outside the snapshot: an ignored file,
 * a file in `skipped`, or a directory that holds one (spec 6.2). This version reports no
 * collisions. Until the full check exists, the per-path check of `runOperation` still refuses
 * to write over such a file, because its content is not the path's before value.
 */
export async function findCollisions(_ports: EnginePorts, _paths: PathPlan[], _skipped: string[]): Promise<PathCollision[]> {
	return [];
}
