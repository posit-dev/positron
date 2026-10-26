/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// No `vscode` import here, so these functions can be unit tested with Vitest.

import * as path from 'path';
import * as semver from 'semver';

/**
 * The parts of an R installation that decide which R starts.
 */
export interface RStartupCandidate {
	readonly usable: boolean;
	readonly current: boolean;
	readonly semVersion: semver.SemVer;
	readonly arch: string;
}

/**
 * The order R installations are listed in: the current R first, then by
 * version, highest first. Two installations with the same version list arm64
 * before x86_64.
 */
export function compareRInstallations(a: RStartupCandidate, b: RStartupCandidate): number {
	if (a.current || b.current) {
		return Number(b.current) - Number(a.current);
	}
	// 'arm64' sorts before 'x86_64'
	return semver.compare(b.semVersion, a.semVersion) || a.arch.localeCompare(b.arch);
}

/**
 * Whether R starts as soon as the folder opens (`immediate`), or only when R is
 * needed (`implicit`). The same strings as `positron.LanguageRuntimeStartupBehavior`.
 */
export type RStartupBehavior = 'immediate' | 'implicit';

/**
 * The R that R's recommendation picks for the open folder, and when it starts.
 */
export interface RStartupChoice<T> {
	readonly installation: T;
	readonly startupBehavior: RStartupBehavior;
}

/**
 * Settings and files that can make the full R search pick a different R than
 * the current R. When any is set, the quick path can't be used.
 */
export interface RFullSearchTriggers {
	/** `positron.r.interpreters.override` lists paths, so the search ignores the current R. */
	readonly overrideListSet: boolean;
	/** An r-versions entry may describe the current R. It can add a label, env vars, or a module to it. */
	readonly rVersionsListsCurrentR: boolean;
	/** Environment modules are set up for R. Those Rs are only found by running module commands. */
	readonly modulesConfiguredForR: boolean;
}

/**
 * What R's recommendation needs to know. Each lookup runs only when the
 * decision needs it, so the full search runs only when the quick path can't
 * answer.
 */
export interface RStartupInputs<T extends RStartupCandidate> {
	/** Looks up the R from `positron.r.interpreters.default`, if that R can start here. */
	pinnedR(): Promise<T | undefined>;
	/** Whether R's `interpreters.startupBehavior` is `manual`. */
	readonly manualStartup: boolean;
	/**
	 * Whether only a pinned R can be returned. True when `interpreters.discovery`
	 * is `definitionsOnly` for R, since the search can find Rs outside the
	 * definitions.
	 */
	readonly pinOnly: boolean;
	/** Whether the open folder has R files, or is empty and you use RStudio. */
	looksLikeRProject(): Promise<boolean>;
	/** The current R, built the way the search builds it, or undefined if there is none. */
	currentR(): Promise<T | undefined>;
	fullSearchTriggers(current: T | undefined): RFullSearchTriggers;
	/** Every R the full search finds, usable or not, or undefined if the search ran out of time. */
	fullSearch(): Promise<T[] | undefined>;
}

/**
 * How to build the R installation that `positron.r.interpreters.default`
 * names.
 */
export interface PinnedRBuild<P> {
	/**
	 * The path to build from: the path discovery lists for this R, so the
	 * runtime ID matches discovery's entry and the interpreter picker doesn't
	 * list it twice. Under `definitionsOnly`, it is always the pinned path, as
	 * `interpreters.definitions` names it.
	 */
	readonly binpath: string;
	readonly current: boolean;
	/**
	 * The conda or pixi environment the pinned path is in, its r-versions
	 * entry's setup, or the modules that provide it, so R starts the same way
	 * as the copy discovery finds.
	 */
	readonly packagerMetadata: P | undefined;
}

/**
 * The path discovery lists for an R that you name by a path, and the conda or
 * pixi environment it is in.
 */
export interface ListedRPath<P> {
	readonly binpath: string;
	readonly current: boolean;
	readonly condaOrPixi: P | undefined;
}

/**
 * What finding the path discovery lists for an R needs to know.
 */
export interface ListedRPathInputs<P> {
	/** Whether two paths name the same file once symlinks are followed. */
	isSameFile(path1: string, path2: string): boolean;
	/** The file a symlink at a path leads to, or the path itself if it isn't a symlink. */
	followLink(path: string): string;
	/** The conda or pixi environment that a path is in. */
	packagerMetadataForPath(path: string): P | undefined;
	/**
	 * The R binary discovery lists for the R at a path. On Windows, `bin\x64\R.exe`
	 * in place of `bin\R.exe` where it exists. Elsewhere, the path itself.
	 */
	listedRBinary(path: string): string;
}

/**
 * Finds the path discovery lists for the R at `userPath`, so an R built from
 * it gets the same runtime ID as discovery's entry and the interpreter picker
 * doesn't list it twice. That is the current R's own path for the current R.
 * Otherwise it is the path itself for an R in a conda or pixi environment, as
 * discovery lists those, or else the file a link leads to. A link into a conda
 * or pixi environment keeps that environment.
 *
 * Used for the pinned R and for adding an R by path.
 *
 * @param userPath A path to an R binary from a setting or from you.
 * @param currentPath The current R's path, with symlinks followed, or undefined if there is none.
 */
export function listedRPath<P>(userPath: string, currentPath: string | undefined, inputs: ListedRPathInputs<P>): ListedRPath<P> {
	const listed = inputs.listedRBinary(userPath);
	const ownEnvironment = inputs.packagerMetadataForPath(listed);
	const followed = ownEnvironment ? listed : inputs.followLink(listed);
	const current = currentPath !== undefined && inputs.isSameFile(currentPath, listed);
	return {
		binpath: current ? currentPath : followed,
		current,
		condaOrPixi: ownEnvironment ?? inputs.packagerMetadataForPath(followed),
	};
}

/**
 * An R that the full R search found by loading environment modules, with the
 * setup that loads them.
 */
export interface ModuleR<P> {
	readonly binpath: string;
	readonly packagerMetadata: P;
}

/**
 * What turning `positron.r.interpreters.default` into an R installation needs
 * to know. Each lookup runs only when the decision needs it.
 */
export interface PinnedRInputs<T extends { readonly usable: boolean }, P> extends ListedRPathInputs<P> {
	/** `interpreters.discovery` is `definitionsOnly` for R. */
	readonly definitionsOnly: boolean;
	/** The pinned path, already resolved, or undefined if the setting isn't set. */
	readonly pinnedPath: string | undefined;
	/** Whether a path is an R entry in `interpreters.definitions`. */
	isDefined(path: string): boolean;
	exists(path: string): boolean;
	/** The current R's path, with symlinks followed, or undefined if there is none. */
	currentRPath(): Promise<string | undefined>;
	/** The setup from the r-versions entry that leads to the R at a path. */
	rVersionsMetadataForPath(path: string): Promise<P | undefined>;
	/**
	 * Whether environment modules may provide R here: environments in
	 * `positron.environmentModules.environments` list R, or an r-versions entry
	 * has a Module and no Path. Reads settings and files only.
	 */
	modulesMayProvideR(): boolean;
	/**
	 * The Rs the full R search found by loading modules, or undefined if the
	 * search ran out of time. Runs the search that R's recommendation and
	 * discovery share, or joins it if it's running.
	 */
	moduleRs(): Promise<readonly ModuleR<P>[] | undefined>;
	install(build: PinnedRBuild<P>): T;
}

/**
 * Picks the R that `positron.r.interpreters.default` names, or undefined if
 * no pin is set, the path doesn't exist, the R there isn't usable (too old,
 * not a real install, or blocked by `exclude` or `override`), or discovery is
 * limited to `interpreters.definitions` and the path isn't one of them.
 *
 * Searches for R only when modules may provide R and nothing else gives the
 * pin a setup, since only the search can tell which module provides an R. If
 * the search runs out of time, returns undefined rather than an R that would
 * start without its module.
 */
export async function choosePinnedR<T extends { readonly usable: boolean }, P>(inputs: PinnedRInputs<T, P>): Promise<T | undefined> {
	const pinnedPath = inputs.pinnedPath;
	if (!pinnedPath || !inputs.exists(pinnedPath) ||
		(inputs.definitionsOnly && !inputs.isDefined(pinnedPath))) {
		return undefined;
	}
	const currentPath = await inputs.currentRPath();
	// Build from the path discovery lists. Definitions match on the exact
	// path, so a defined pin keeps its own.
	const listed = inputs.definitionsOnly ?
		{
			binpath: pinnedPath,
			current: currentPath !== undefined && inputs.isSameFile(currentPath, pinnedPath),
			condaOrPixi: inputs.packagerMetadataForPath(pinnedPath),
		} :
		listedRPath(pinnedPath, currentPath, inputs);
	const { current, condaOrPixi } = listed;
	let binpath = listed.binpath;
	// Conda and pixi metadata win over r-versions metadata, as in discovery.
	let packagerMetadata: P | undefined = condaOrPixi ?? await inputs.rVersionsMetadataForPath(pinnedPath);
	if (packagerMetadata === undefined && inputs.modulesMayProvideR()) {
		const moduleRs = await inputs.moduleRs();
		if (!moduleRs) {
			return undefined;
		}
		const moduleR = moduleRs.find(r => inputs.definitionsOnly ?
			r.binpath === pinnedPath :
			inputs.isSameFile(r.binpath, pinnedPath));
		if (moduleR) {
			packagerMetadata = moduleR.packagerMetadata;
			if (!inputs.definitionsOnly) {
				binpath = moduleR.binpath;
			}
		}
	}
	const installation = inputs.install({ binpath, current, packagerMetadata });
	return installation.usable ? installation : undefined;
}

/**
 * The r-versions entry whose Path is the home of the R at `binpath`, if any.
 * Entries with only a Module are skipped, since finding their R means loading
 * the module.
 *
 * @param entries The r-versions entries
 * @param binpath The path to the R binary
 * @param isSameFile Whether two paths name the same file once symlinks are followed
 */
export function rVersionsEntryForR<E extends { readonly path?: string }>(
	entries: readonly E[],
	binpath: string,
	isSameFile: (path1: string, path2: string) => boolean
): E | undefined {
	return entries.find(entry => entry.path !== undefined && isSameFile(path.join(entry.path, 'bin', 'R'), binpath));
}

/**
 * Picks the R that R's recommendation returns for the open folder, and when it
 * starts.
 *
 * - Under `manual`, Positron won't start R on its own, so the folder isn't
 *   checked. A pinned R is returned to start when R is needed, and otherwise
 *   nothing is returned.
 * - A pinned R starts right away in a folder that looks like an R project, and
 *   otherwise when R is needed.
 * - Otherwise, when only a pinned R can be returned, nothing is returned.
 * - Otherwise, in a folder that looks like an R project, the R the search
 *   lists first starts right away.
 * - Otherwise nothing is returned.
 */
export async function chooseStartupR<T extends RStartupCandidate>(inputs: RStartupInputs<T>): Promise<RStartupChoice<T> | undefined> {
	// Look up the pin while the folder is searched for R files.
	const [pinned, rProject] = await Promise.all([
		inputs.pinnedR(),
		inputs.manualStartup ? Promise.resolve(false) : inputs.looksLikeRProject(),
	]);
	if (pinned) {
		return { installation: pinned, startupBehavior: rProject ? 'immediate' : 'implicit' };
	}
	if (!rProject || inputs.pinOnly) {
		return undefined;
	}
	const installation = await pickStartupR(inputs);
	return installation ? { installation, startupBehavior: 'immediate' } : undefined;
}

/**
 * Picks the same R the search lists first: the current R if it's usable,
 * otherwise the highest usable version.
 *
 * Every other R sorts after the current R, so when the current R is usable the
 * full search can't change the answer, and is skipped. Listing conda and pixi
 * environments doesn't matter for the same reason. The full search still runs
 * when one of `fullSearchTriggers()` is set, or when there's no usable current R.
 * If the full search runs out of time, nothing is picked.
 */
export async function pickStartupR<T extends RStartupCandidate>(
	inputs: Pick<RStartupInputs<T>, 'currentR' | 'fullSearchTriggers' | 'fullSearch'>
): Promise<T | undefined> {
	const current = await inputs.currentR();
	const triggers = inputs.fullSearchTriggers(current);
	if (current?.usable && !triggers.overrideListSet && !triggers.rVersionsListsCurrentR && !triggers.modulesConfiguredForR) {
		return current;
	}
	const installs = await inputs.fullSearch();
	return installs ? firstListedR(installs) : undefined;
}

/**
 * The R the search lists first among the given Rs: the current R, otherwise
 * the highest version. Only usable Rs count.
 */
export function firstListedR<T extends RStartupCandidate>(installs: readonly T[]): T | undefined {
	return installs.filter(inst => inst.usable).sort(compareRInstallations)[0];
}

/**
 * Whether an r-versions entry may describe the R at `binpath`: an entry whose
 * Path is that R's home, or an entry with only a Module, whose R can't be
 * known without running module commands.
 *
 * Paths must match as written, because that's how the full search decides two
 * R binaries are the same. An entry for /opt/R/current, a symlink to
 * /opt/R/4.5.2, doesn't match /opt/R/4.5.2/bin/R.
 */
export function rVersionsMayListR(
	entries: readonly { readonly path?: string; readonly module?: string }[],
	binpath: string
): boolean {
	return entries.some(entry => entry.path
		? path.join(entry.path, 'bin', 'R') === binpath
		: entry.module !== undefined);
}

/**
 * Shares one run of a lookup between callers that ask for the same key while
 * it runs. Once the run finishes it is dropped, so a result is never reused,
 * and a changed setting is always looked up again.
 */
export class InFlightLookup<K, V> {
	private _running: { readonly key: K; readonly result: Promise<V> } | undefined;

	/**
	 * @param key What the lookup is for, such as the setting's value.
	 * @param lookUp Runs the lookup, unless one for the same key is running.
	 * @returns The running lookup's result.
	 */
	run(key: K, lookUp: () => Promise<V>): Promise<V> {
		// Check for a running lookup first: an unset key, such as no pin, is
		// undefined too.
		if (this._running && this._running.key === key) {
			return this._running.result;
		}
		const result: Promise<V> = lookUp().finally(() => {
			if (this._running?.result === result) {
				this._running = undefined;
			}
		});
		this._running = { key, result };
		return result;
	}
}

/**
 * Holds one search so the next search can reuse its result instead of running
 * again. The result is handed out once, and only while it's fresh: until
 * `maxAgeMs` after the search finishes.
 */
export class ReusableSearch<T> {
	private _held: { result: Promise<T>; finishedAt?: number } | undefined;

	constructor(
		private readonly _maxAgeMs: number,
		private readonly _now: () => number = Date.now
	) { }

	/**
	 * Holds a search for the next `take()`.
	 * @returns The search's result, unchanged.
	 */
	hold(result: Promise<T>): Promise<T> {
		const held: { result: Promise<T>; finishedAt?: number } = { result };
		this._held = held;
		result.then(
			() => { held.finishedAt = this._now(); },
			() => {
				if (this._held === held) {
					this._held = undefined;
				}
			});
		return result;
	}

	/**
	 * Takes the held search, if it's still running or finished recently.
	 * @returns Its result, or undefined if there's nothing fresh to reuse.
	 */
	take(): Promise<T> | undefined {
		const result = this.peek();
		this._held = undefined;
		return result;
	}

	/**
	 * Returns the held search, if it's still running or finished recently,
	 * and keeps holding it.
	 */
	peek(): Promise<T> | undefined {
		const held = this._held;
		if (!held || (held.finishedAt !== undefined && this._now() - held.finishedAt > this._maxAgeMs)) {
			return undefined;
		}
		return held.result;
	}
}

/**
 * One search shared by R's recommendation, the pinned R's lookup, and R's
 * interpreter search. The first search is held. The recommendation and the
 * pin lookup join it, and the interpreter search that follows reuses it
 * instead of running again (see `ReusableSearch`).
 *
 * @param search Runs the search.
 * @param maxAgeMs How long after it finishes a held search can be reused.
 */
export function createSharedSearch<T>(search: () => Promise<T>, maxAgeMs: number): {
	/**
	 * Runs the search, or joins the held one, and holds its result for the
	 * next `forDiscovery()`.
	 * @param timeoutMs How long to wait for the result. The search keeps
	 *   running after that, so `forDiscovery()` can still reuse it.
	 * @returns The result, or undefined if the search ran out of time.
	 */
	forRecommendation(timeoutMs: number): Promise<T | undefined>;
	/** Reuses the held search if it's fresh, and otherwise runs the search. */
	forDiscovery(): Promise<T>;
} {
	const reusable = new ReusableSearch<T>(maxAgeMs);
	return {
		forRecommendation: timeoutMs => waitUpTo(reusable.peek() ?? reusable.hold(search()), timeoutMs),
		forDiscovery: () => reusable.take() ?? search(),
	};
}

/**
 * Waits up to `timeoutMs` for a promise, without stopping the work behind it.
 * @returns The promise's result, or undefined if it ran out of time.
 */
async function waitUpTo<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<undefined>(resolve => {
		timer = setTimeout(() => resolve(undefined), timeoutMs);
	});
	try {
		return await Promise.race([promise, timedOut]);
	} finally {
		clearTimeout(timer);
	}
}
