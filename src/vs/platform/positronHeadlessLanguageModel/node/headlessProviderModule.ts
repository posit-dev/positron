/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { HeadlessProviders, HeadlessProvidersOptions } from 'ai-provider-bridge/headless';
import { pathToFileURL } from 'url';
import { Emitter } from '../../../base/common/event.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { join } from '../../../base/common/path.js';
import { SelfHealingLazyPromise } from '../../../base/common/positron/async.js';
import * as semver from '../../../base/common/semver/semver.js';
import { hasKey } from '../../../base/common/types.js';
import { ExtensionType, IExtensionIdentifier } from '../../extensions/common/extensions.js';
import { IExtensionManagementService, ILocalExtension } from '../../extensionManagement/common/extensionManagement.js';
import { areSameExtensions } from '../../extensionManagement/common/extensionManagementUtil.js';
import { ILogService } from '../../log/common/log.js';
import { IProductService } from '../../product/common/productService.js';
import { IUserDataProfilesService } from '../../userDataProfile/common/userDataProfile.js';
import { IProviderModuleSource } from '../common/engine.js';

const ASSISTANT_ID = 'posit.assistant';

type ProviderModule = typeof import('ai-provider-bridge/headless');

interface IProviderSelection {
	readonly providers: HeadlessProviders;
	readonly source: IProviderModuleSource;
}

/** Finds the newest valid Posit Assistant install across every profile. */
export async function findAssistantProviderModule(
	extensions: IExtensionManagementService,
	profiles: IUserDataProfilesService,
): Promise<{ folder: string; version: string } | { reason: string }> {
	const installs = await Promise.all(profiles.profiles.map(profile =>
		extensions.getInstalled(ExtensionType.User, profile.extensionsResource)));
	const matches = installs.flat().filter(extension => areSameExtensions(extension.identifier, { id: ASSISTANT_ID }));
	const byVersionDescending = (a: ILocalExtension, b: ILocalExtension) => semver.rcompare(a.manifest.version, b.manifest.version);
	const newest = matches.filter(extension => extension.isValid).sort(byVersionDescending)[0];
	if (newest) {
		return { folder: join(newest.location.fsPath, 'dist', 'provider-module'), version: newest.manifest.version };
	}
	const newestInvalid = matches.sort(byVersionDescending)[0];
	if (!newestInvalid) {
		return { reason: 'Posit Assistant is not installed' };
	}
	const message = newestInvalid.validations[0]?.[1];
	return { reason: `No installed Posit Assistant is compatible with this Positron: ${newestInvalid.manifest.version}: ${message}` };
}

async function loadFromAssistant(
	extensions: IExtensionManagementService,
	profiles: IUserDataProfilesService,
	productService: IProductService,
	options: HeadlessProvidersOptions,
): Promise<(IProviderSelection & { version: string; folder: string }) | { reason: string }> {
	const found = await findAssistantProviderModule(extensions, profiles);
	if (hasKey(found, { reason: true })) {
		return found;
	}
	const bundled = productService.bootstrapExtensions?.find(extension => extension.name === ASSISTANT_ID);
	if (bundled && semver.lte(found.version, bundled.version)) {
		return { reason: `Posit Assistant ${found.version} is not newer than the bundled ${bundled.version}` };
	}
	const entry = join(found.folder, 'index.js');
	const module: Partial<ProviderModule> = await import(/* @vite-ignore */ pathToFileURL(entry).href);
	if (typeof module.createHeadlessProviders !== 'function') {
		throw new Error(`${entry}: missing createHeadlessProviders export`);
	}
	return {
		providers: module.createHeadlessProviders(options),
		source: { kind: 'assistant', folder: found.folder },
		version: found.version,
		folder: found.folder,
	};
}

/** Picks Assistant's provider module when it is usable, else the compiled-in copy. */
export async function selectProviders(
	extensions: IExtensionManagementService,
	profiles: IUserDataProfilesService,
	productService: IProductService,
	options: HeadlessProvidersOptions,
	loadCompiledIn: () => Promise<Pick<ProviderModule, 'createHeadlessProviders'>>,
	logService: ILogService,
): Promise<IProviderSelection> {
	let reason: string;
	try {
		const result = await loadFromAssistant(extensions, profiles, productService, options);
		if (hasKey(result, { providers: true })) {
			logService.info(`[provider-module] Using Posit Assistant ${result.version}: ${result.folder}`);
			return { providers: result.providers, source: result.source };
		}
		reason = result.reason;
	} catch (err) {
		reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
	}
	logService.warn(`[provider-module] Using the compiled-in copy: ${reason}`);
	const compiledIn = await loadCompiledIn();
	return { providers: compiledIn.createHeadlessProviders(options), source: { kind: 'compiled-in', reason } };
}

/** The one provider module instance for this process. */
export class HeadlessProviderModule extends Disposable {

	private readonly _selection = new SelfHealingLazyPromise(() => this.select());
	private _latest: Promise<IProviderSelection> | undefined;
	private _disposed = false;
	private readonly _onDidReselect = this._register(new Emitter<void>());
	/** Fires when Posit Assistant changes and the next {@link get} selects again. */
	readonly onDidReselect = this._onDidReselect.event;

	constructor(
		private readonly _extensions: IExtensionManagementService,
		private readonly _profiles: IUserDataProfilesService,
		private readonly _productService: IProductService,
		private readonly _logService: ILogService,
		// Positron doesn't scrub its control variables from `process.env`, so a live read is correct.
		private readonly _catalog: HeadlessProvidersOptions['catalog'] = { envVars: process.env },
	) {
		super();
		const reselectFor = (ids: IExtensionIdentifier[]) => {
			if (ids.some(id => areSameExtensions(id, { id: ASSISTANT_ID }))) {
				this.reselect();
			}
		};
		this._register(_extensions.onDidInstallExtensions(e => reselectFor(e.map(r => r.identifier))));
		this._register(_extensions.onDidUninstallExtension(e => reselectFor([e.identifier])));
		this._register(toDisposable(() => {
			this._disposed = true;
			this._latest?.then(selection => selection.providers.dispose(), () => { });
		}));
	}

	get(): Promise<IProviderSelection> {
		if (this._disposed) {
			return Promise.reject(new Error('The provider module was disposed'));
		}
		this._latest = this._selection.get();
		return this._latest;
	}

	/** Keeps the old copy alive so requests already running on it can finish. */
	private reselect(): void {
		this._latest = undefined;
		this._selection.clear();
		this._onDidReselect.fire();
	}

	private select(): Promise<IProviderSelection> {
		const logService = this._logService;
		const options: HeadlessProvidersOptions = {
			logger: {
				info: (m: string, ...a: unknown[]) => logService.info(m, ...a),
				warn: (m: string, ...a: unknown[]) => logService.warn(m, ...a),
				error: (m: string, ...a: unknown[]) => logService.error(m, ...a),
				debug: (m: string, ...a: unknown[]) => logService.debug(m, ...a),
				trace: (m: string, ...a: unknown[]) => logService.trace(m, ...a),
			},
			userAgent: 'Positron/headless',
			catalog: this._catalog,
		};
		return selectProviders(
			this._extensions,
			this._profiles,
			this._productService,
			options,
			() => import('ai-provider-bridge/headless'),
			logService,
		);
	}
}
