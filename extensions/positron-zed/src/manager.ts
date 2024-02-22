/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PositronZedRuntimeSession } from './positronZedLanguageRuntime';

/**
 * Generates metadata for an instance of the the Zed language runtime.
 *
 * @param context The VS Code extension context.
 * @param runtimeId The ID to assign to the runtime.
 * @param version The version of the runtime.
 *
 * @returns A full runtime metadata object.
 */
function generateZedMetadata(context: vscode.ExtensionContext,
	runtimeId: string,
	version: string): positron.LanguageRuntimeMetadata {

	// Create the icon SVG path.
	const iconSvgPath = path.join(context.extensionPath, 'resources', 'zed-icon.svg');

	// Create the runtime names.
	const runtimeShortName = version;
	const runtimeName = `Zed ${runtimeShortName}`;

	const metadata: positron.LanguageRuntimeMetadata = {
		runtimePath: '/zed',
		runtimeId,
		languageId: 'zed',
		languageName: 'Zed',
		runtimeName,
		runtimeShortName,
		runtimeSource: 'Test',
		languageVersion: version,
		base64EncodedIconSvg: fs.readFileSync(iconSvgPath).toString('base64'),
		runtimeVersion: '0.0.1',
		startupBehavior: positron.LanguageRuntimeStartupBehavior.Implicit,
		extraData: {}
	};

	return metadata;
}

/**
 * Manages the Zed language runtimes; implements Positron's API for runtime
 * management.
 */
export class ZedRuntimeManager implements positron.LanguageRuntimeManager {
	constructor(private readonly _context: vscode.ExtensionContext) {

	}

	/**
	 * "Discovers" the Zed language runtimes.
	 *
	 * @returns An async generator that yields metadata for the Zed language
	 */
	discoverRuntimes(): AsyncGenerator<positron.LanguageRuntimeMetadata, any, unknown> {
		const context = this._context;

		const generator = async function* getPositronZedLanguageRuntimes() {
			yield generateZedMetadata(
				context,
				'00000000-0000-0000-0000-000000000200',
				'2.0.0');
			yield generateZedMetadata(
				context,
				'00000000-0000-0000-0000-000000000100',
				'1.0.0');
			yield generateZedMetadata(
				context,
				'00000000-0000-0000-0000-000000000098',
				'0.98.0');
		};

		return generator();
	}

	/**
	 * Start a new session for the Zed language runtime.
	 *
	 * @param runtimeMetadata The metadata for the runtime to create a session for.
	 * @param sessionId  he unique identifier for the session.
	 * @param sessionName The human-readable name for the session.
	 * @param sessionMode The mode in which the session is to be run.
	 *
	 * @returns The new session.
	 */
	async createSession(runtimeMetadata: positron.LanguageRuntimeMetadata, sessionId: string, sessionName: string, sessionMode: positron.LanguageRuntimeSessionMode): Promise<positron.LanguageRuntimeSession> {
		return new PositronZedRuntimeSession(this._context,
			runtimeMetadata,
			sessionId,
			sessionName,
			sessionMode);
	}
}
