/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The part of the WebAssembly API the SQL analyzer uses.
 *
 * Declared here because the repository's TypeScript configuration includes no `dom` lib and
 * `@types/node` does not declare these globals, even though the extension host provides them.
 * Only what `analyzer.ts` actually calls is declared, so this stays a description of the contract
 * that file relies on rather than a partial copy of the specification.
 */
declare namespace WebAssembly {
	/** A compiled module, which can be instantiated any number of times. */
	class Module {
		constructor(bytes: BufferSource);
	}

	/** One instantiation of a module, with its own linear memory. */
	class Instance {
		constructor(module: Module, imports?: Record<string, Record<string, unknown>>);
		readonly exports: Record<string, unknown>;
	}

	/** A module's linear memory. `buffer` is replaced whenever the memory grows. */
	interface Memory {
		readonly buffer: ArrayBuffer;
	}
}
