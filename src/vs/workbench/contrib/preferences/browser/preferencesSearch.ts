/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettingsEditorModel, ISetting, ISettingsGroup, ISearchResult, IGroupFilter, SettingMatchType, ISettingMatch } from '../../../services/preferences/common/preferences.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { distinct } from '../../../../base/common/arrays.js';
import * as strings from '../../../../base/common/strings.js';
import { IMatch, matchesContiguousSubString, matchesSubString, matchesWords } from '../../../../base/common/filters.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IPreferencesSearchService, IRemoteSearchProvider, ISearchProvider, IWorkbenchSettingsConfiguration } from '../common/preferences.js';
import { IExtensionManagementService, ILocalExtension } from '../../../../platform/extensionManagement/common/extensionManagement.js';
import { IWorkbenchExtensionEnablementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ExtensionType } from '../../../../platform/extensions/common/extensions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IAiRelatedInformationService, RelatedInformationType, SettingInformationResult } from '../../../services/aiRelatedInformation/common/aiRelatedInformation.js';
import { TfIdfCalculator, TfIdfDocument } from '../../../../base/common/tfIdf.js';
import { IStringDictionary } from '../../../../base/common/collections.js';
import { nullRange } from '../../../services/preferences/common/preferencesModels.js';

export interface IEndpointDetails {
	urlBase?: string;
	key?: string;
}

export class PreferencesSearchService extends Disposable implements IPreferencesSearchService {
	declare readonly _serviceBrand: undefined;

	// @ts-expect-error disable remote search for now, ref https://github.com/microsoft/vscode/issues/172411
	private _installedExtensions: Promise<ILocalExtension[]>;
	private _remoteSearchProvider: IRemoteSearchProvider | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService
	) {
		super();

		// This request goes to the shared process but results won't change during a window's lifetime, so cache the results.
		this._installedExtensions = this.extensionManagementService.getInstalled(ExtensionType.User).then(exts => {
			// Filter to enabled extensions that have settings
			return exts
				.filter(ext => this.extensionEnablementService.isEnabled(ext))
				.filter(ext => ext.manifest && ext.manifest.contributes && ext.manifest.contributes.configuration)
				.filter(ext => !!ext.identifier.uuid);
		});
	}

	private get remoteSearchAllowed(): boolean {
		const workbenchSettings = this.configurationService.getValue<IWorkbenchSettingsConfiguration>().workbench.settings;
		return workbenchSettings.enableNaturalLanguageSearch;
	}

	getRemoteSearchProvider(filter: string): IRemoteSearchProvider | undefined {
		if (!this.remoteSearchAllowed) {
			return undefined;
		}

		this._remoteSearchProvider ??= this.instantiationService.createInstance(RemoteSearchProvider);
		this._remoteSearchProvider.setFilter(filter);
		return this._remoteSearchProvider;
	}

	getLocalSearchProvider(filter: string): LocalSearchProvider {
		return this.instantiationService.createInstance(LocalSearchProvider, filter);
	}
}

function cleanFilter(filter: string): string {
	// Remove " and : which are likely to be copypasted as part of a setting name.
	// Leave other special characters which the user might want to search for.
	return filter
		.replace(/[":]/g, ' ')
		.replace(/  /g, ' ')
		.trim();
}

export class LocalSearchProvider implements ISearchProvider {
	static readonly EXACT_MATCH_SCORE = 10000;
	static readonly START_SCORE = 1000;

	constructor(
		private _filter: string,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		this._filter = cleanFilter(this._filter);
	}

	searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken): Promise<ISearchResult | null> {
		if (!this._filter) {
			return Promise.resolve(null);
		}

		let orderedScore = LocalSearchProvider.START_SCORE; // Sort is not stable
		const settingMatcher = (setting: ISetting) => {
			const { matches, matchType, keyMatchScore } = new SettingMatches(this._filter, setting, true, true, (filter, setting) => preferencesModel.findValueMatches(filter, setting), this.configurationService);
			const score = strings.equalsIgnoreCase(this._filter, setting.key) ?
				LocalSearchProvider.EXACT_MATCH_SCORE :
				orderedScore--;

			return matches.length ?
				{
					matches,
					matchType,
					keyMatchScore,
					score
				} :
				null;
		};

		const filterMatches = preferencesModel.filterSettings(this._filter, this.getGroupFilter(this._filter), settingMatcher);
		const exactMatch = filterMatches.find(m => m.score === LocalSearchProvider.EXACT_MATCH_SCORE);
		if (exactMatch) {
			return Promise.resolve({
				filterMatches: [exactMatch],
				exactMatch: true
			});
		} else {
			return Promise.resolve({
				filterMatches
			});
		}
	}

	private getGroupFilter(filter: string): IGroupFilter {
		const regex = strings.createRegExp(filter, false, { global: true });
		return (group: ISettingsGroup) => {
			return group.id !== 'defaultOverrides' && regex.test(group.title);
		};
	}
}

export class SettingMatches {
	readonly matches: IRange[];
	/** Whether to use the new key matching search algorithm that calculates more weights for each result */
	useNewKeyMatchingSearch: boolean = false;
	matchType: SettingMatchType = SettingMatchType.None;
	/**
	 * A match score for key matches to allow comparing key matches against each other.
	 * Otherwise, all key matches are treated the same, and sorting is done by ToC order.
	 */
	keyMatchScore: number = 0;

	constructor(
		searchString: string,
		setting: ISetting,
		requireFullQueryMatch: boolean,
		private searchDescription: boolean,
		valuesMatcher: (filter: string, setting: ISetting) => IRange[],
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		this.useNewKeyMatchingSearch = this.configurationService.getValue('workbench.settings.useWeightedKeySearch') === true;
		this.matches = distinct(this._findMatchesInSetting(searchString, setting), (match) => `${match.startLineNumber}_${match.startColumn}_${match.endLineNumber}_${match.endColumn}_`);
	}

	private _findMatchesInSetting(searchString: string, setting: ISetting): IRange[] {
		const result = this._doFindMatchesInSetting(searchString, setting);
		return result;
	}

	private _keyToLabel(settingId: string): string {
		const label = settingId
			.replace(/[-._]/g, ' ')
			.replace(/([a-z]+)([A-Z])/g, '$1 $2')
			.replace(/([A-Za-z]+)(\d+)/g, '$1 $2')
			.replace(/(\d+)([A-Za-z]+)/g, '$1 $2')
			.toLowerCase();
		return label;
	}

	private _doFindMatchesInSetting(searchString: string, setting: ISetting): IRange[] {
		const descriptionMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();
		const keyMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();
		const valueMatchingWords: Map<string, IRange[]> = new Map<string, IRange[]>();

		// Key search
		const settingKeyAsWords: string = this._keyToLabel(setting.key);
		const queryWords = new Set<string>(searchString.split(' '));
		for (const word of queryWords) {
			// Check if the key contains the word.
			// Force contiguous matching iff we're using the new algorithm.
			const keyMatches = matchesWords(word, settingKeyAsWords, this.useNewKeyMatchingSearch);
			if (keyMatches?.length) {
				keyMatchingWords.set(word, keyMatches.map(match => this.toKeyRange(setting, match)));
			}
		}
		if (this.useNewKeyMatchingSearch) {
			if (keyMatchingWords.size === queryWords.size) {
				// All words in the query matched with something in the setting key.
				this.matchType |= SettingMatchType.KeyMatch;
				// Score based on how many words matched out of the entire key, penalizing longer setting names.
				const settingKeyAsWordsCount = settingKeyAsWords.split(' ').length;
				this.keyMatchScore = (keyMatchingWords.size / settingKeyAsWordsCount) + (1 / setting.key.length);
			}
			const keyMatches = matchesSubString(searchString, settingKeyAsWords);
			if (keyMatches?.length) {
				// Handles cases such as "editor formonpast" with missing letters.
				keyMatchingWords.set(searchString, keyMatches.map(match => this.toKeyRange(setting, match)));
				this.matchType |= SettingMatchType.KeyMatch;
				this.keyMatchScore = keyMatchingWords.size;
			}
		} else {
			// Fall back to the old algorithm.
			if (keyMatchingWords.size) {
				this.matchType |= SettingMatchType.KeyMatch;
				this.keyMatchScore = keyMatchingWords.size;
			}
		}
		const keyIdMatches = matchesContiguousSubString(searchString, setting.key);
		if (keyIdMatches?.length) {
			// Handles cases such as "editor.formatonpaste" where the user tries searching for the ID.
			keyMatchingWords.set(setting.key, keyIdMatches.map(match => this.toKeyRange(setting, match)));
			if (this.useNewKeyMatchingSearch) {
				this.matchType |= SettingMatchType.KeyMatch;
				this.keyMatchScore = Math.max(this.keyMatchScore, searchString.length / setting.key.length);
			} else {
				this.matchType |= SettingMatchType.KeyIdMatch;
			}
		}

		// Check if the match was for a language tag group setting such as [markdown].
		// In such a case, move that setting to be last.
		if (setting.overrides?.length && (this.matchType & SettingMatchType.KeyMatch)) {
			this.matchType = SettingMatchType.LanguageTagSettingMatch;
			const keyRanges = keyMatchingWords.size ?
				Array.from(keyMatchingWords.values()).flat() : [];
			return [...keyRanges];
		}

		// New algorithm only: exit early if the key already matched.
		if (this.useNewKeyMatchingSearch && (this.matchType & SettingMatchType.KeyMatch)) {
			const keyRanges = keyMatchingWords.size ?
				Array.from(keyMatchingWords.values()).flat() : [];
			return [...keyRanges];
		}

		// Description search
		if (this.searchDescription && this.matchType !== SettingMatchType.None) {
			for (const word of queryWords) {
				// Search the description lines.
				for (let lineIndex = 0; lineIndex < setting.description.length; lineIndex++) {
					const descriptionMatches = matchesContiguousSubString(word, setting.description[lineIndex]);
					if (descriptionMatches?.length) {
						descriptionMatchingWords.set(word, descriptionMatches.map(match => this.toDescriptionRange(setting, match, lineIndex)));
					}
				}
			}
			if (descriptionMatchingWords.size === queryWords.size) {
				this.matchType |= SettingMatchType.DescriptionOrValueMatch;
			} else {
				// Clear out the match for now. We want to require all words to match in the description.
				descriptionMatchingWords.clear();
			}
		}

		// Value search
		// Check if the value contains all the words.
		if (setting.enum?.length) {
			// Search all string values of enums.
			for (const option of setting.enum) {
				if (typeof option !== 'string') {
					continue;
				}
				valueMatchingWords.clear();
				for (const word of queryWords) {
					const valueMatches = matchesContiguousSubString(word, option);
					if (valueMatches?.length) {
						valueMatchingWords.set(word, valueMatches.map(match => this.toValueRange(setting, match)));
					}
				}
				if (valueMatchingWords.size === queryWords.size) {
					this.matchType |= SettingMatchType.DescriptionOrValueMatch;
					break;
				} else {
					// Clear out the match for now. We want to require all words to match in the value.
					valueMatchingWords.clear();
				}
			}
		} else {
			// Search single string value.
			const settingValue = this.configurationService.getValue(setting.key);
			if (typeof settingValue === 'string') {
				for (const word of queryWords) {
					const valueMatches = matchesContiguousSubString(word, settingValue);
					if (valueMatches?.length) {
						valueMatchingWords.set(word, valueMatches.map(match => this.toValueRange(setting, match)));
					}
				}
				if (valueMatchingWords.size === queryWords.size) {
					this.matchType |= SettingMatchType.DescriptionOrValueMatch;
				} else {
					// Clear out the match for now. We want to require all words to match in the value.
					valueMatchingWords.clear();
				}
			}
		}

		const descriptionRanges = descriptionMatchingWords.size ?
			Array.from(descriptionMatchingWords.values()).flat() : [];
		const keyRanges = keyMatchingWords.size ?
			Array.from(keyMatchingWords.values()).flat() : [];
		const valueRanges = valueMatchingWords.size ?
			Array.from(valueMatchingWords.values()).flat() : [];
		return [...descriptionRanges, ...keyRanges, ...valueRanges];
	}

	private toKeyRange(setting: ISetting, match: IMatch): IRange {
		return {
			startLineNumber: setting.keyRange.startLineNumber,
			startColumn: setting.keyRange.startColumn + match.start,
			endLineNumber: setting.keyRange.startLineNumber,
			endColumn: setting.keyRange.startColumn + match.end
		};
	}

	private toDescriptionRange(setting: ISetting, match: IMatch, lineIndex: number): IRange {
		const descriptionRange = setting.descriptionRanges[lineIndex];
		if (!descriptionRange) {
			// This case occurs with added settings such as the
			// manage extension setting.
			return nullRange;
		}
		return {
			startLineNumber: descriptionRange.startLineNumber,
			startColumn: descriptionRange.startColumn + match.start,
			endLineNumber: descriptionRange.endLineNumber,
			endColumn: descriptionRange.startColumn + match.end
		};
	}

	private toValueRange(setting: ISetting, match: IMatch): IRange {
		return {
			startLineNumber: setting.valueRange.startLineNumber,
			startColumn: setting.valueRange.startColumn + match.start + 1,
			endLineNumber: setting.valueRange.startLineNumber,
			endColumn: setting.valueRange.startColumn + match.end + 1
		};
	}
}

class AiRelatedInformationSearchKeysProvider {
	private settingKeys: string[] = [];
	private settingsRecord: IStringDictionary<ISetting> = {};
	private currentPreferencesModel: ISettingsEditorModel | undefined;

	constructor(
		private readonly aiRelatedInformationService: IAiRelatedInformationService
	) { }

	updateModel(preferencesModel: ISettingsEditorModel) {
		if (preferencesModel === this.currentPreferencesModel) {
			return;
		}

		this.currentPreferencesModel = preferencesModel;
		this.refresh();
	}

	private refresh() {
		this.settingKeys = [];
		this.settingsRecord = {};

		if (
			!this.currentPreferencesModel ||
			!this.aiRelatedInformationService.isEnabled()
		) {
			return;
		}

		for (const group of this.currentPreferencesModel.settingsGroups) {
			if (group.id === 'mostCommonlyUsed') {
				continue;
			}
			for (const section of group.sections) {
				for (const setting of section.settings) {
					this.settingKeys.push(setting.key);
					this.settingsRecord[setting.key] = setting;
				}
			}
		}
	}

	getSettingKeys(): string[] {
		return this.settingKeys;
	}

	getSettingsRecord(): IStringDictionary<ISetting> {
		return this.settingsRecord;
	}
}

class AiRelatedInformationSearchProvider implements IRemoteSearchProvider {
	private static readonly AI_RELATED_INFORMATION_MAX_PICKS = 5;

	private readonly _keysProvider: AiRelatedInformationSearchKeysProvider;
	private _filter: string = '';

	constructor(
		@IAiRelatedInformationService private readonly aiRelatedInformationService: IAiRelatedInformationService
	) {
		this._keysProvider = new AiRelatedInformationSearchKeysProvider(aiRelatedInformationService);
	}

	setFilter(filter: string) {
		this._filter = cleanFilter(filter);
	}

	async searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken | undefined): Promise<ISearchResult | null> {
		if (
			!this._filter ||
			!this.aiRelatedInformationService.isEnabled()
		) {
			return null;
		}

		this._keysProvider.updateModel(preferencesModel);

		return {
			filterMatches: await this.getAiRelatedInformationItems(token)
		};
	}

	private async getAiRelatedInformationItems(token?: CancellationToken | undefined) {
		const settingsRecord = this._keysProvider.getSettingsRecord();

		const filterMatches: ISettingMatch[] = [];
		const relatedInformation = await this.aiRelatedInformationService.getRelatedInformation(this._filter, [RelatedInformationType.SettingInformation], token ?? CancellationToken.None) as SettingInformationResult[];
		relatedInformation.sort((a, b) => b.weight - a.weight);

		for (const info of relatedInformation) {
			if (filterMatches.length === AiRelatedInformationSearchProvider.AI_RELATED_INFORMATION_MAX_PICKS) {
				break;
			}
			const pick = info.setting;
			filterMatches.push({
				setting: settingsRecord[pick],
				matches: [settingsRecord[pick].range],
				matchType: SettingMatchType.RemoteMatch,
				keyMatchScore: 0,
				score: info.weight
			});
		}

		return filterMatches;
	}
}

class TfIdfSearchProvider implements IRemoteSearchProvider {
	private static readonly TF_IDF_PRE_NORMALIZE_THRESHOLD = 50;
	private static readonly TF_IDF_POST_NORMALIZE_THRESHOLD = 0.7;
	private static readonly TF_IDF_MAX_PICKS = 5;

	private _currentPreferencesModel: ISettingsEditorModel | undefined;
	private _filter: string = '';
	private _documents: TfIdfDocument[] = [];
	private _settingsRecord: IStringDictionary<ISetting> = {};

	constructor() {
	}

	setFilter(filter: string) {
		this._filter = cleanFilter(filter);
	}

	keyToLabel(settingId: string): string {
		const label = settingId
			.replace(/[-._]/g, ' ')
			.replace(/([a-z]+)([A-Z])/g, '$1 $2')
			.replace(/([A-Za-z]+)(\d+)/g, '$1 $2')
			.replace(/(\d+)([A-Za-z]+)/g, '$1 $2')
			.toLowerCase();
		return label;
	}

	settingItemToEmbeddingString(item: ISetting): string {
		let result = `Setting Id: ${item.key}\n`;
		result += `Label: ${this.keyToLabel(item.key)}\n`;
		result += `Description: ${item.description}\n`;
		return result;
	}

	async searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken | undefined): Promise<ISearchResult | null> {
		if (!this._filter) {
			return null;
		}

		if (this._currentPreferencesModel !== preferencesModel) {
			// Refresh the documents and settings record
			this._currentPreferencesModel = preferencesModel;
			this._documents = [];
			this._settingsRecord = {};
			for (const group of preferencesModel.settingsGroups) {
				if (group.id === 'mostCommonlyUsed') {
					continue;
				}
				for (const section of group.sections) {
					for (const setting of section.settings) {
						this._documents.push({
							key: setting.key,
							textChunks: [this.settingItemToEmbeddingString(setting)]
						});
						this._settingsRecord[setting.key] = setting;
					}
				}
			}
		}

		return {
			filterMatches: await this.getTfIdfItems(token)
		};
	}

	private async getTfIdfItems(token?: CancellationToken | undefined): Promise<ISettingMatch[]> {
		const filterMatches: ISettingMatch[] = [];
		const tfIdfCalculator = new TfIdfCalculator();
		tfIdfCalculator.updateDocuments(this._documents);
		const tfIdfRankings = tfIdfCalculator.calculateScores(this._filter, token ?? CancellationToken.None);
		tfIdfRankings.sort((a, b) => b.score - a.score);
		const maxScore = tfIdfRankings[0].score;

		if (maxScore < TfIdfSearchProvider.TF_IDF_PRE_NORMALIZE_THRESHOLD) {
			// Reject all the matches.
			return [];
		}

		for (const info of tfIdfRankings) {
			if (info.score / maxScore < TfIdfSearchProvider.TF_IDF_POST_NORMALIZE_THRESHOLD || filterMatches.length === TfIdfSearchProvider.TF_IDF_MAX_PICKS) {
				break;
			}
			const pick = info.key;
			filterMatches.push({
				setting: this._settingsRecord[pick],
				matches: [this._settingsRecord[pick].range],
				matchType: SettingMatchType.RemoteMatch,
				keyMatchScore: 0,
				score: info.score
			});
		}

		return filterMatches;
	}
}

class RemoteSearchProvider implements IRemoteSearchProvider {
	private adaSearchProvider: AiRelatedInformationSearchProvider | undefined;
	private tfIdfSearchProvider: TfIdfSearchProvider | undefined;
	private filter: string = '';

	constructor(
		@IAiRelatedInformationService private readonly aiRelatedInformationService: IAiRelatedInformationService
	) {
	}

	private initializeSearchProviders() {
		if (this.aiRelatedInformationService.isEnabled()) {
			this.adaSearchProvider ??= new AiRelatedInformationSearchProvider(this.aiRelatedInformationService);
		}
		this.tfIdfSearchProvider ??= new TfIdfSearchProvider();
	}

	setFilter(filter: string): void {
		this.initializeSearchProviders();
		this.filter = filter;
		if (this.adaSearchProvider) {
			this.adaSearchProvider.setFilter(filter);
		}
		this.tfIdfSearchProvider!.setFilter(filter);
	}

	searchModel(preferencesModel: ISettingsEditorModel, token?: CancellationToken): Promise<ISearchResult | null> {
		if (!this.filter) {
			return Promise.resolve(null);
		}

		if (!this.adaSearchProvider) {
			return this.tfIdfSearchProvider!.searchModel(preferencesModel, token);
		}

		// Use TF-IDF search as a fallback, ref https://github.com/microsoft/vscode/issues/224946
		return this.adaSearchProvider.searchModel(preferencesModel, token).then((results) => {
			return results?.filterMatches.length ? results : this.tfIdfSearchProvider!.searchModel(preferencesModel, token);
		});
	}
}

registerSingleton(IPreferencesSearchService, PreferencesSearchService, InstantiationType.Delayed);
