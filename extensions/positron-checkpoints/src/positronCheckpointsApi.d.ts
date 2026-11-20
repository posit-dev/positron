/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This file is removed when this branch is joined with the branch that adds the `checkpoints`
// namespace to `src/positron-dts/positron.d.ts`. Until then it declares the one function this
// extension calls, so `extension.ts` type-checks here.

import * as vscode from 'vscode';
import { CheckpointsEngine } from './engine/types';

declare module 'positron' {
	namespace checkpoints {
		/**
		 * Registers a checkpoints engine: the engine's calls, with the change event as a
		 * `vscode.Event`. Positron uses the first registered engine.
		 *
		 * @param engine The engine to register
		 * @returns A disposable that unregisters the engine when disposed
		 */
		export function registerEngine(engine: Omit<CheckpointsEngine, 'onDidChangeState'> & { onDidChangeState: vscode.Event<void> }): vscode.Disposable;
	}
}
