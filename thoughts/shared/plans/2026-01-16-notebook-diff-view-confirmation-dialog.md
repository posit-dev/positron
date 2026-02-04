---
type: implementation-plan
title: "Add Confirmation Dialog for Diff View Setting Changes with Pending Diffs"
created: 2026-01-16
status: draft
---

# Add Confirmation Dialog for Diff View Setting Changes with Pending Diffs

## Overview

This plan addresses a bug where changing the notebook assistant's "show diff for edits" setting while there are unconfirmed chat editing diffs causes mangled diff views. The fix adds a confirmation dialog that prompts users to Accept All, Reject All, or Cancel when they attempt to change the setting with pending diffs.

## Current State Analysis

When the diff view setting is changed from enabled to disabled (or vice versa) while `ChatEditingModifiedNotebookEntry` instances exist with pending changes, the entries maintain stale baseline content. This causes subsequent edits to be compared against outdated baselines, resulting in incorrect diff displays.

### Key Discoveries:
- `ChatEditingModifiedNotebookEntry` instances persist after diff view is disabled (`src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingModifiedNotebookEntry.ts:63`)
- The `mirrorNotebookEdits()` method processes non-diff edits as user modifications (`src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingModifiedNotebookEntry.ts:264`)
- No guard flags are set for non-diff path edits, causing incorrect processing
- Pattern for checking pending diffs exists: `entry.state.get() === ModifiedFileEntryState.Modified` (`src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingSession.ts:371`)

## Desired End State

When a user changes the "show diff for edits" setting in the AssistantPanel while there are unconfirmed diffs for the notebook:
1. A confirmation dialog appears with three options: "Accept All", "Reject All", or "Cancel"
2. "Accept All" accepts all pending diffs and applies the setting change
3. "Reject All" rejects all pending diffs and applies the setting change
4. "Cancel" keeps the current setting and pending diffs unchanged
5. If there are no pending diffs, the setting changes immediately without confirmation

### Verification:
- [ ] Create a notebook edit with diff view enabled
- [ ] Without accepting/rejecting, change the diff view setting
- [ ] Confirmation dialog appears
- [ ] Each button option works correctly
- [ ] No mangled diffs appear after confirmation

## What We're NOT Doing

- Not implementing auto-accept or auto-reject without user confirmation
- Not blocking all setting changes when diffs are pending
- Not handling diffs from other notebooks (only current notebook)
- Not changing the underlying chat editing service architecture
- Not modifying how the extension creates edits

## Implementation Approach

We'll use the built-in `IDialogService.prompt()` pattern for the confirmation dialog, following the established pattern used in chat editing confirmations. The `IChatEditingService` will be added to detect pending diffs and handle accept/reject operations. When multiple editing sessions exist, we'll use the first matching session (as sessions are recency-sorted).

## Phase 1: Add Service Dependencies

### Overview
Add the chat editing service and dialog service to AskAssistantAction and pass them to AssistantPanel as props.

### Changes Required:

#### 1. Add Service Imports
**File**: `src/vs/workbench/contrib/positronNotebook/browser/AskAssistantAction.tsx`
**Changes**: Add imports and service extraction

```typescript
// Add to imports at line 18
import { IChatEditingService } from '../../chat/common/chatEditingService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';

// In run() method, after line 70 (layoutService extraction)
const chatEditingService = accessor.get(IChatEditingService);
const dialogService = accessor.get(IDialogService);

// Update AssistantPanel props at line 111-123, add:
chatEditingService={chatEditingService}
dialogService={dialogService}
```

#### 2. Update AssistantPanel Props Interface
**File**: `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx`
**Changes**: Add services to props interface

```typescript
// In AssistantPanelProps interface at line 68-80, add:
chatEditingService: IChatEditingService;
dialogService: IDialogService;
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compilation passes: `npm run compile`
- [x] No linting errors: `npm run eslint`

#### Manual Verification:
- [ ] AssistantPanel still opens without errors
- [ ] Service is accessible within the component

---

## Phase 2: Add Pending Diffs Detection Logic

### Overview
Implement helper functions to detect pending diffs for the current notebook.

### Changes Required:

#### 1. Add Detection Helpers
**File**: `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx`
**Changes**: Add helper functions before the component

```typescript
// Add imports at top of file
import { IChatEditingService, IChatEditingSession, IModifiedFileEntry, ModifiedFileEntryState } from '../../../chat/common/chatEditingService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';

// Add before AssistantPanel component (around line 320)
interface PendingDiffsInfo {
	hasPending: boolean;
	session: IChatEditingSession | undefined;
	entry: IModifiedFileEntry | undefined;
}

function findPendingDiffs(
	chatEditingService: IChatEditingService,
	notebookUri: URI
): PendingDiffsInfo {
	// Iterate through all editing sessions (first matching session wins as they are recency-sorted)
	for (const session of chatEditingService.editingSessionsObs.get()) {
		// Get entry for this notebook URI
		const entry = session.getEntry(notebookUri);

		// Check if entry has pending changes
		if (entry && entry.state.get() === ModifiedFileEntryState.Modified) {
			return { hasPending: true, session, entry };
		}
	}

	return { hasPending: false, session: undefined, entry: undefined };
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compilation passes: `npm run compile`
- [x] Helper function correctly typed

#### Manual Verification:
- [ ] Function correctly identifies pending diffs when present
- [ ] Returns false when no diffs exist

---

## Phase 3: Add Confirmation Dialog Function

### Overview
Create a confirmation dialog function using IDialogService.prompt(), following the pattern from chat editing confirmations.

### Changes Required:

#### 1. Add Confirmation Dialog Function
**File**: `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx`
**Changes**: Add helper function for showing confirmation dialog

```typescript
// Add before AssistantPanel component (after findPendingDiffs function)
async function showPendingDiffsConfirmation(
	entry: IModifiedFileEntry,
	dialogService: IDialogService,
	localize: typeof import('../../../../nls.js').localize
): Promise<'accept' | 'reject' | 'cancel'> {
	const { result } = await dialogService.prompt({
		title: localize('positronNotebook.assistant.pendingDiffs.title', 'Pending Edits'),
		message: localize('positronNotebook.assistant.pendingDiffs.message',
			'You have unconfirmed edits in this notebook. What would you like to do with them?'),
		type: 'info',
		cancelButton: true,
		buttons: [
			{
				label: localize('positronNotebook.assistant.acceptPending', 'Accept Pending Edits'),
				run: async () => {
					await entry.accept();
					return 'accept' as const;
				}
			},
			{
				label: localize('positronNotebook.assistant.rejectPending', 'Reject Pending Edits'),
				run: async () => {
					await entry.reject();
					return 'reject' as const;
				}
			}
		],
	});

	return result ?? 'cancel';
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compilation passes: `npm run compile`
- [x] Function correctly typed with all parameters

#### Manual Verification:
- [ ] Dialog appears with correct title and message
- [ ] All three buttons are available (Accept, Reject, Cancel)
- [ ] Each button performs the expected action

---

## Phase 4: Integrate Confirmation Check with Setting Change

### Overview
Modify the handleShowDiffChanged function to check for pending diffs and show confirmation dialog before applying changes.

### Changes Required:

#### 1. Update Setting Change Handler
**File**: `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx`
**Changes**: Modify handleShowDiffChanged function to be async and use dialog

```typescript
// Replace handleShowDiffChanged at line 398-405
const handleShowDiffChanged = async (value: ShowDiffOverride) => {
	if (panelState.status !== 'ready') {
		return;
	}

	// Check for pending diffs
	const { hasPending, entry } = findPendingDiffs(
		chatEditingService,
		panelState.notebook.uri
	);

	if (hasPending && entry) {
		// Show confirmation dialog
		const action = await showPendingDiffsConfirmation(entry, dialogService, localize);

		if (action === 'cancel') {
			// User cancelled, don't change the setting
			return;
		}

		// User either accepted or rejected, now apply the setting change
		// (accept/reject was already handled by the dialog buttons)
		setShowDiffOverride(value);
		updateShowDiffOverrideInNotebook(panelState.notebook, value, logService);
	} else {
		// No pending diffs, apply immediately
		setShowDiffOverride(value);
		updateShowDiffOverrideInNotebook(panelState.notebook, value, logService);
	}
};
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compilation passes: `npm run compile`
- [x] Function correctly typed with all parameters

#### Manual Verification:
- [ ] Setting changes immediately when no pending diffs
- [ ] Confirmation dialog appears when pending diffs exist
- [ ] Original setting preserved when dialog is cancelled
- [ ] Setting changes after accept/reject actions complete

---

## Testing Strategy

### Unit Tests:
- Test `findPendingDiffs` helper with mock chat editing service
- Test dialog state management
- Test accept/reject error handling

### Integration Tests:
- Test full flow: create diff → change setting → accept
- Test full flow: create diff → change setting → reject
- Test full flow: create diff → change setting → cancel
- Test no dialog when no pending diffs

### Manual Testing Steps:
1. Open a Positron notebook
2. Enable "Show diff for edits" in assistant panel
3. Make an edit using the assistant
4. Without accepting/rejecting, change the diff setting
5. Verify confirmation dialog appears
6. Test each button option:
   - Accept Pending Edits: Verify diffs are accepted and setting changes
   - Reject Pending Edits: Verify diffs are rejected and setting changes
   - Cancel: Verify setting remains unchanged
7. Test with no pending diffs - verify immediate setting change
8. Test with multiple pending cell edits
9. Test error scenarios (network failure during accept/reject)

## Performance Considerations

- `findPendingDiffs` iterates through all editing sessions but this is typically a small set (1-2 sessions)
- Using `IDialogService.prompt()` avoids custom React state management and additional CSS overhead
- Accept/reject operations are handled within the dialog button actions, ensuring clean async flow
- No additional rendering overhead from custom overlay components

## Migration Notes

No migration needed as this is a new feature that doesn't change existing data structures or persisted state.

## References

- Original bug investigation: Mangled diff views when toggling setting with existing ChatEditingModifiedNotebookEntry
- Chat editing service: `src/vs/workbench/contrib/chat/common/chatEditingService.ts`
- Similar pattern: `src/vs/workbench/contrib/chat/browser/chatEditorInput.ts:424` (showClearEditingSessionConfirmation)
- AssistantPanel implementation: `src/vs/workbench/contrib/positronNotebook/browser/AssistantPanel/AssistantPanel.tsx`
