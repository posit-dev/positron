/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILanguageRuntimeMetadata } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { Event } from 'vs/base/common/event';

export const IRuntimeStartupService =
	createDecorator<IRuntimeStartupService>('runtimeStartupService');

/**
 * The phases through which the runtime startup service progresses as Positron
 * starts.
 */
export enum RuntimeStartupPhase {
	/**
	 * Phase 1: The startup sequence has not yet begun.
	 */
	Initializing = 'initializing',

	/**
	 * Phase 2: If the workspace is not trusted, we cannot proceed with startup,
	 * since many runtimes run arbitrary code at startup (often from the
	 * workspace contents) and we cannot trust them to do so safely. The startup
	 * sequence stays at `AwaitingTrust` until workspace trust is granted.
	 */
	AwaitingTrust = 'awaitingTrust',

	/**
	 * Phase 3: Positron is reconnecting to runtimes that are already running.
	 * We only enter this phase when reloading the UI, or when reopening a
	 * browser tab.
	 */
	Reconnecting = 'reconnecting',

	/**
	 * Phase 4: Positron is starting any runtimes that are affiliated with the
	 * workspace. We enter this phase on a fresh start of Positron, when no
	 * existing sessions are running.
	 */
	Starting = 'starting',

	/**
	 * Phase 5: Positron is discovering all the runtimes on the machine. This
	 * can take a while, but does precede startup for workspaces that have no
	 * affiliated runtimes (so we don't know what to start yet).
	 */
	Discovering = 'discovering',

	/**
	 * Phase 6: Startup is complete. In this phase, we start any runtimes
	 * recommended by extensions if nothing was started in previous phases.
	 */
	Complete = 'complete',
}

/**
 * The IRuntimeStartupService is responsible for coordinating the process by
 * which runtimes are automatically started when a workspace is opened, and
 * reconnected to when a workspace is reloaded or reopened.
 */
export interface IRuntimeStartupService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Event tracking the current startup phase.
	 */
	onDidChangeRuntimeStartupPhase: Event<RuntimeStartupPhase>;

	/**
	 * The current startup phase.
	 */
	readonly startupPhase: RuntimeStartupPhase;

	/**
	 * Get the preferred runtime for a language. This approximates "the runtime
	 * the user probably wants to start for the given language" and takes a
	 * number of variables into account, including the what's active now, what
	 * they've used recently, etc.
	 *
	 * @param languageId The language identifier.
	 */
	getPreferredRuntime(languageId: string): ILanguageRuntimeMetadata;

	/**
	 * Whether the workspace has affiliated runtimes.
	 */
	hasAffiliatedRuntime(): boolean;

	/**
	 * Gets metadata for the runtime affiliated with the workspace for the given
	 * languageId, or undefined if no runtimes with the given languageId are
	 * affiliated with the workspace.
	 *
	 * @param languageId The language identifier.
	 */
	getAffiliatedRuntimeMetadata(languageId: string): ILanguageRuntimeMetadata | undefined;

	/**
	 * Signal that discovery of language runtimes is complete. Called from the
	 * extension host.
	 */
	completeDiscovery(): void;
}
