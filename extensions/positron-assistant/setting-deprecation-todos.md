### what to do

one setting at a time. each commit is for removal of one setting and related code.

1. Remove the setting from package.json
2. Remove the NLS string from package.nls.json
3. Clean up the setting references in the positron assistant extension code, e2e test, and related positron core code if applicable
4. ensure no compilation errors
5. commit the changes with commit message "remove `SETTING`" and NO COAUTHORED BY
6. mark the setting as done in the below list
6. do the next setting

### list of settings

- [x] positron.assistant.toolDetails.enable
- [x] positron.assistant.showTokenUsage.enable
- [x] positron.assistant.alwaysIncludeCopilotTools
- [x] chat.useCopilotParticipantsWithOtherProviders
- [x] positron.assistant.providerTimeout
- [ ] positron.assistant.alwaysEnableApplyInEditorAction
- [ ] positron.assistant.useAnthropicSdk
- [ ] positron.assistant.streamingEdits.enable
- [ ] positron.assistant.toolErrors.propagate
- [ ] positron.assistant.gitIntegration.enable
- [ ] positron.assistant.models.preference.byProvider
- [ ] positron.assistant.models.preference.global
- [ ] positron.assistant.models.preference.anthropic
- [ ] positron.assistant.models.preference.githubCopilot
- [ ] positron.assistant.models.preference.amazonBedrock
- [ ] positron.assistant.models.preference.snowflakeCortex
- [ ] positron.assistant.models.preference.msFoundry
- [ ] positron.assistant.models.preference.openAI
- [ ] positron.assistant.models.preference.customProvider
- [ ] positron.assistant.models.preference.positAI
- [ ] positron.assistant.models.preference.google
- [ ] positron.assistant.models.preference.echo
- [ ] positron.assistant.models.preference.error
- [ ] positron.assistant.maxInputTokens
- [ ] positron.assistant.maxOutputTokens

### defer to later

- [ ] positron.assistant.inlineCompletions.enable
