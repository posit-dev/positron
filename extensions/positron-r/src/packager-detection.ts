/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import type { CondaMetadata, PixiMetadata } from './r-installation';

/**
 * How many directories above the R binary to look for an environment root.
 * The deepest layout is Windows Conda: `<env>\Lib\R\bin\x64\R.exe`.
 */
const MAX_DEPTH = 5;

/**
 * Infers the Conda or Pixi environment containing an R binary from the
 * environment's layout on disk, so an R known only by its path still launches
 * with its environment activated.
 *
 * @param binpath The path to the R binary.
 * @returns Metadata for the containing environment, or undefined if the binary
 *   isn't in one.
 */
export function packagerMetadataForPath(binpath: string): CondaMetadata | PixiMetadata | undefined {
	let dir = path.dirname(binpath);
	for (let i = 0; i < MAX_DEPTH; i++) {
		if (fs.existsSync(path.join(dir, 'conda-meta'))) {
			// Pixi environments are Conda environments at `<project>/.pixi/envs/<name>`.
			const envsDir = path.dirname(dir);
			const pixiDir = path.dirname(envsDir);
			if (path.basename(envsDir) === 'envs' && path.basename(pixiDir) === '.pixi') {
				const project = path.dirname(pixiDir);
				const manifestPath = ['pixi.toml', 'pyproject.toml']
					.map(name => path.join(project, name))
					.find(file => fs.existsSync(file));
				if (manifestPath) {
					return { environmentPath: dir, manifestPath, environmentName: path.basename(dir) };
				}
			}
			return { environmentPath: dir };
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return undefined;
}
