/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line header/header
import { Disposable } from '../../../base/common/lifecycle.js';
import { isObject } from '../../../base/common/types.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { ILogService } from '../../log/common/log.js';

export const IAdminPolicyService = createDecorator<IAdminPolicyService>('adminPolicyService');

export interface IAdminPolicyService {
	readonly _serviceBrand: undefined;

	/**
	 * Get all enforced settings
	 */
	getAllSettings(): ReadonlyArray<AdminPolicy>;
}

export interface AdminPolicy {
	key: string;
	value: any;
}

export class AdminPolicyService extends Disposable implements IAdminPolicyService {

	readonly _serviceBrand: undefined;

	private readonly settings: Array<AdminPolicy>;

	constructor(
		private readonly enforcedSettings: string,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.settings = this.read();
	}

	private read(): Array<AdminPolicy> {
		const settings: Array<AdminPolicy> = [];

		try {
			this.logService.info(`[AdminPolicyService] Parsing enforced settings: ${this.enforcedSettings}`);
			const raw = JSON.parse(this.enforcedSettings);

			if (!isObject(raw)) {
				throw new Error('Enforced settings isn\'t a JSON object');
			}

			for (const key of Object.keys(raw)) {
				settings.push({ key, value: raw[key] });
				this.logService.info(`[AdminPolicyService] Added policy: ${key} = ${JSON.stringify(raw[key])}`);
			}

			this.logService.info(`[AdminPolicyService] Successfully parsed ${settings.length} policies`);
		} catch (error) {
			this.logService.error(`[AdminPolicyService] Failed to read enforced settings ${this.enforcedSettings}`, error);
		}

		return settings;
	}

	public getAllSettings(): ReadonlyArray<AdminPolicy> {
		this.logService.info(`[AdminPolicyService] getAllSettings() called, returning ${this.settings.length} policies`);
		return this.settings;
	}
}
