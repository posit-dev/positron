/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as positron from 'positron';

import { JuliaInstallation, ReasonDiscovered } from './julia-installation';

/**
 * Creates a unique runtime ID for a Julia installation.
 */
function createRuntimeId(installation: JuliaInstallation): string {
	const hash = crypto.createHash('sha256');
	hash.update(installation.binpath);
	hash.update(installation.version);
	return hash.digest('hex').substring(0, 16);
}

/**
 * Creates a human-readable runtime name for a Julia installation.
 */
function createRuntimeName(installation: JuliaInstallation): string {
	let name = `Julia ${installation.version}`;

	// Add architecture info if not the native architecture
	const nativeArch = process.arch === 'arm64' ? 'aarch64' : process.arch;
	if (installation.arch !== nativeArch) {
		name += ` (${installation.arch})`;
	}

	// Add source info for non-standard installations
	if (installation.reasonDiscovered === ReasonDiscovered.JULIAUP) {
		name += ' (juliaup)';
	}

	return name;
}

/**
 * Determines the startup behavior for a Julia installation.
 */
function getStartupBehavior(installation: JuliaInstallation): positron.LanguageRuntimeStartupBehavior {
	// If this is the current/default Julia, start it immediately
	if (installation.current) {
		return positron.LanguageRuntimeStartupBehavior.Immediate;
	}

	// Otherwise, start implicitly (when needed)
	return positron.LanguageRuntimeStartupBehavior.Implicit;
}

/**
 * Creates Positron runtime metadata from a Julia installation.
 */
export function createJuliaRuntimeMetadata(
	installation: JuliaInstallation
): positron.LanguageRuntimeMetadata {
	return {
		runtimeId: createRuntimeId(installation),
		runtimeName: createRuntimeName(installation),
		runtimeShortName: `Julia ${installation.version}`,
		runtimePath: installation.binpath,
		runtimeVersion: installation.version,
		runtimeSource: installation.reasonDiscovered,
		languageId: 'julia',
		languageName: 'Julia',
		languageVersion: installation.version,
		base64EncodedIconSvg: JULIA_ICON_SVG,
		sessionLocation: positron.LanguageRuntimeSessionLocation.Browser,
		startupBehavior: getStartupBehavior(installation),
		extraRuntimeData: {
			homepath: installation.homepath,
			arch: installation.arch,
		},
	};
}

/**
 * Julia logo SVG icon (base64 encoded).
 * Using the official Julia logo colors.
 */
const JULIA_ICON_SVG = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
	<circle cx="64" cy="64" r="24" fill="#CB3C33"/>
	<circle cx="32" cy="96" r="24" fill="#9558B2"/>
	<circle cx="96" cy="96" r="24" fill="#389826"/>
</svg>
`.trim()).toString('base64');
