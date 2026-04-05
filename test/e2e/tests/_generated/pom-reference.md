# POM Reference

Auto-generated from POM source files. Do not edit manually.
Generated: 2026-04-05

Total POMs: 50

---

## assistant (pages/positronAssistant.ts)
- verifyChatButtonVisible()
- openPositronAssistantChat()
- closeInlineChat()
- openModelPickerDropdown()
- runConfigureProviders()
- clickConfigureProvidersLink()
- clickConfigureProvidersButton()
- verifyConfigureProvidersButtonVisible()
- verifyInlineChatInputsVisible()
- verifyCodeBlockActions()
- pickModel()
- expectManageModelsVisible()
- selectModelProvider(provider: ModelProvider)
- loginModelProvider(provider: ModelProvider, options: LoginModelProviderOptions = {}) -- Signs in to a model provider with the appropriate authentication method.
- logoutModelProvider(provider: ModelProvider, options: { timeout?: number } = {}) -- Signs out from a model provider.
- enterApiKey(apiKey: string)
- clickSignInButton()
- clickCloseButton({ abandonChanges = true } = {})
- clickSignOutButton()
- verifySignOutButtonVisible(timeout: number = 15000)
- verifySignInButtonVisible(timeout: number = 15000)
- verifyAuthMethod(type: 'oauth' | 'apiKey')
- completeOAuthDeviceCodeFlow(config: OAuthDeviceCodeConfig, options: LoginModelProviderOptions = {}) -- Completes an OAuth device code flow by launching a separate browser,
- getProviderButtonNames(): Promise<string[]> -- Gets the provider display names in their display order from the Configure Providers modal.
- enterChatMessage(message: string) -- Enters a chat message and optionally waits for the response to complete.
- sendChatMessageAndWait(message: string, options: { timeout?: number } = {}): Promise<EnterChatMessageResult> -- Sends a chat message and waits for the response to complete, automatically
- waitForResponseComplete(timeout: number = 60000) -- Waits for the chat response to complete by waiting for the loading state to disappear.
- expectResponseComplete(timeout: number = 10000) -- Asserts that the chat response is complete (not loading).
- expectChatPanelVisible(timeout: number = 10000) -- Verifies the chat panel is visible.
- expectChatResponseVisible(timeout: number = 10000) -- Verifies a chat response is visible.
- clickChatCodeRunButton(codeblock: string)
- clickKeepButton(timeout: number = 10000)
- clickAllowButton(timeout: number = 10000): Promise<boolean> -- Clicks the "Allow" button that appears when the assistant requests permission to use a tool.
- clickNewChatButton()
- verifyTokenUsageVisible()
- verifyTokenUsageNotVisible()
- verifyTotalTokenUsageVisible()
- verifyNumberOfVisibleResponses(expectedCount: number, checkTokenUsage: boolean = false)
- getTokenUsage()
- getTotalTokenUsage()
- waitForReadyToSend(timeout: number = 25000)
- waitForSendButtonVisible()
- selectChatMode(mode: string)
- selectChatModel(model: string)
- expectModelInPicker(text: string | RegExp): Promise<void> -- Asserts that a model item with the given text exists in the picker dropdown.
- expectVendorSeparator(vendor: string): Promise<void> -- Asserts that a vendor separator with the given name exists in the picker dropdown.
- getModelPickerItems(): Promise<Array<{ label: string; isDefault: boolean }>> -- Gets all model items from the model picker dropdown.
- getModelPickerItemsForVendor(vendor: string): Promise<Array<{ label: string; isDefault: boolean }>> -- Gets model items for a specific vendor from the model picker dropdown.
- verifyModelHasDefaultIndicator(modelName: string) -- Verifies that a specific model shows the "(default)" indicator in the model picker.
- verifyModelDoesNotHaveDefaultIndicator(modelName: string) -- Verifies that a model does NOT have the "(default)" indicator.
- closeModelPickerDropdown() -- Closes the model picker dropdown by pressing Escape if it is open.
- getChatResponseText(exportFolder?: string)
- findChatExportFile(exportFolder?: string): Promise<string | null> -- Finds the most recent chat export JSON file matching the pattern 'positron-chat-export-*'
- parseChatResponseFromFile(filePath: string): Promise<string> -- Parses the chat response text from a chat export JSON file
- parseAvailableToolsFromFile(filePath: string): Promise<string[]> -- Parses the available tools from a chat export JSON file
- getAvailableTools(exportFolder?: string): Promise<string[]> -- Gets the available tools from the most recent chat response.
- renameChatExportFile(filePath: string): Promise<void> -- Renames a chat export file to mark it as processed

## clipboard (pages/clipboard.ts)
- copy(timeoutMs = 5000): Promise<void> -- Safely grants clipboard permissions. Chromium-only - Firefox/WebKit
- cut(timeoutMs = 5000): Promise<void>
- paste(text?: string): Promise<void> -- Pastes content using keyboard shortcut, or synthetic paste event for WebKit.
- getClipboardText(): Promise<string | null> -- Pastes text by dispatching a synthetic paste event with the text embedded in clipboardData.
- expectClipboardTextToBe(expectedText: string, stripTrailingChar?: string, { timeout = 20000 } = {}): Promise<void>
- setClipboardText(text: string): Promise<void>
- getClipboardImage(): Promise<Buffer | null>
- clearClipboard(): Promise<void>

## connections (pages/connections.ts)
- openConnectionsNodes(nodes: string[])
- assertConnectionNodes(nodes: string[]): Promise<void>
- openConnectionPane()
- viewConnection(name: string)
- openTree()
- deleteConnection()
- initiateConnection(language: string, driver: string): Promise<void>
- fillConnectionsInputs(fields: Record<string, string>)
- connect()
- expandConnectionDetails(name: string)

## console (pages/console.ts)
- clickStartAnotherSessionButton(runtime: SessionRuntimes) -- Start a new session via the `+ v` button in the console.
- clickDuplicateSessionButton() -- Duplicate the active session via the `+` button in the console.
- createFile( runtime: 'Python' | 'R', fileName: string ) -- Create a single file via console
- expectSessionContextMenuToContain(runtimes: MenuItemState[]) -- The session context menu contains the expected runtimes.
- executeCode(languageName: 'Python' | 'R', code: string, options?: { timeout?: number; waitForReady?: boolean; maximizeConsole?: boolean }): Promise<void> -- Execute code in the console via the quick-input command palette. Waits for the (See also: waitForReady to wait for the prompt independently, pasteCodeToConsole to paste code directly into the console input)
- logConsoleContents() -- Log all visible console text to the test logger. Useful for debugging failures.
- typeToConsole(text: string, pressEnter = false, delay = 10) -- Type text into the console input character-by-character, simulating keyboard input. (See also: pasteCodeToConsole to insert text instantly without keystroke simulation)
- clearInput() -- Clear the current console input line (select-all then delete). (See also: clearButton to clear the entire console output history)
- sendEnterKey() -- Press Enter in the console to submit the current input line.
- waitForReady(prompt: string, timeout = 30000): Promise<void> -- Wait for the console to display the language prompt, indicating the runtime is (See also: waitForReadyAndStarted to also confirm a "started" message appeared, waitForReadyAndRestarted to also confirm a "restarted" message appeared)
- waitForReadyAndStarted(prompt: string, timeout = 30000, expectedCount = 1): Promise<void> -- Wait for the console to show the ready prompt AND for a "started" message to (See also: waitForReady for prompt-only readiness, waitForReadyAndRestarted to wait for a "restarted" message instead)
- waitForReadyAndRestarted(prompt: string, timeout = 30000): Promise<void> -- Wait for the console to show the ready prompt AND for a "restarted" message to (See also: waitForReady for prompt-only readiness, waitForReadyAndStarted to wait for a "started" message instead)
- doubleClickConsoleText(text: string) -- Double-click a span of text in the console output. Useful for selecting a word or
- waitForConsoleContents( consoleTextOrRegex: string | RegExp, options: { timeout?: number; expectedCount?: number; exact?: boolean; } = {} ): Promise<string[]> -- Wait for specific text or a regex pattern to appear in the console output. Returns (See also: waitForCurrentConsoleLineContents to check only the active input line)
- waitForCurrentConsoleLineContents(expectedText: string, timeout = 30000): Promise<string> -- Wait for the active console input line to contain the expected text. Returns the (See also: waitForConsoleContents to check anywhere in the console output)
- waitForConsoleExecution({ timeout = 20000 }: { timeout?: number } = {}): Promise<void> -- Wait for the currently running console execution to finish by polling until the (See also: waitForExecutionComplete which checks the interrupt runtime icon directly)
- waitForHistoryContents(expectedText: string, count = 1, timeout = 30000): Promise<string[]> -- Wait for history completion items to appear in the console, filtered to those
- maximizeConsole() -- Maximize the console panel by clicking the maximize button in the bottom bar.
- sendInterrupt() -- Send a keyboard interrupt (Ctrl+C) to the active console session via the hotkey. (See also: interruptExecution to click the "Interrupt execution" toolbar button instead)
- pasteCodeToConsole(code: string, sendEnterKey = false) -- Paste code into the console input using clipboard injection. Faster and more (See also: typeToConsole to simulate character-by-character keyboard input instead, executeCode to run code via the quick-input command palette)
- pasteInMonaco( locator: Locator, text: string, maxRetries = 3 ): Promise<void> -- Paste text into a Monaco editor element via a synthetic ClipboardEvent. Retries (See also: pasteCodeToConsole for the higher-level helper that targets the console input)
- getLastClickableLink() -- Get a locator for the last clickable hyperlink in the active console output.
- waitForExecutionStarted(timeout = 30000): Promise<void> -- Wait until the runtime interrupt button becomes visible, indicating that code (See also: waitForExecutionComplete to wait for execution to finish)
- waitForExecutionComplete(timeout = 30000): Promise<void> -- Wait until the runtime interrupt button is hidden, indicating that code execution (See also: waitForExecutionStarted to wait for execution to begin, waitForConsoleExecution for an equivalent check via the aria-label button)
- focus() -- Focus the console panel using the keyboard hotkey. Prefer this over (See also: clickConsoleTab to bring the Console tab to the foreground when it may be hidden)
- clickConsoleTab() -- Click the Console tab to bring it to the foreground. Includes a retry loop to (See also: focus to focus the console via hotkey without needing to click the tab)
- interruptExecution() -- Click the "Interrupt execution" toolbar button to stop a running script. (See also: sendInterrupt to interrupt via keyboard shortcut without requiring button visibility)
- expectSuggestionListCount(count: number): Promise<void> -- Assert that the autocomplete suggestion list contains exactly `count` items. (See also: expectSuggestionListToContain to assert a specific item is present by label)
- expectSuggestionListToContain(label: string): Promise<void> -- Assert that the autocomplete suggestion list contains an item matching `label`. (See also: expectSuggestionListCount to assert the total number of suggestions)
- expectConsoleToContainError(error: string): Promise<void> -- Assert that an error message matching `error` is visible in the console output. (See also: waitForConsoleContents to wait for arbitrary text (not just errors) in output)

## contextMenu (pages/dialog-contextMenu.ts)
- triggerAndClick({ menuTrigger, menuItemLabel, menuItemType = 'menuitem', menuTriggerButton = 'left' }: ContextMenuClick): Promise<void> -- Triggers a context menu and clicks a specified menu item.
- triggerAndVerifyMenuItems({ menuTrigger, menuTriggerButton = 'left', menuItemStates }: Omit<ContextMenuClick, 'menuItemType' | 'menuItemLabel'> & { clickButton?: ClickButton; menuItemStates: MenuItemState[] }): Promise<void> -- Verifies the states of multiple context menu items.

## databot (pages/databot.ts)
- open(): Promise<void> -- Opens Databot in the editor panel via command palette.
- waitForReady(timeout: number = 30000): Promise<void> -- Waits for Databot to be ready by verifying the chat input is visible.
- expectTabVisible(): Promise<void> -- Verifies that the Databot tab is visible (tab is on the main page, not in the webview).
- expectWelcomeVisible(): Promise<void> -- Verifies that the welcome message is displayed.
- clickSuggestedQuestion(questionText: string): Promise<void> -- Clicks a suggested question link by its text.
- enterMessage(message: string): Promise<void> -- Enters a message in the chat input.
- clickSend(): Promise<void> -- Clicks the send button to submit the current message.
- clickStop(): Promise<void> -- Clicks the stop button to cancel a running response.
- sendMessage(message: string, waitForResponse: boolean = true, options: { newConversation?: boolean } = {}): Promise<void> -- Sends a chat message with options.
- waitForResponseComplete(timeout: number = 60000): Promise<void> -- Waits for the chat response to complete by waiting for the stop button
- expectResponseVisible(): Promise<void> -- Verifies that an assistant response is visible.
- getLastResponseText(): Promise<string> -- Gets the text content of the most recent assistant response.
- expectUserMessageVisible(): Promise<void> -- Verifies a user message is visible.
- expectInlinePlotVisible(timeout: number = 30000): Promise<void> -- Verifies that an inline plot image is visible in the chat.
- copyCodeBlock(index: number = 0): Promise<void> -- Clicks the copy button on a code block.
- insertCodeBlockAtCursor(index: number = 0): Promise<void> -- Clicks the "Insert At Cursor" button on a code block.
- insertCodeBlockIntoNewFile(index: number = 0): Promise<void> -- Clicks the "Insert into New File" button on a code block.
- expectToolConfirmVisible(): Promise<void> -- Verifies the tool confirmation dialog is visible.
- allowToolForSession(): Promise<void> -- Selects "Allow for this session" from the tool confirmation dropdown.
- allowToolOnce(): Promise<void> -- Clicks the main "Allow" button on the tool confirmation dialog (allow once).
- declineTool(): Promise<void> -- Clicks "Decline" on the tool confirmation dialog.
- startNewConversation(): Promise<void> -- Starts a new conversation if possible.
- clickSessions(): Promise<void> -- Clicks the sessions button in the sidebar.
- clickVariables(): Promise<void> -- Clicks the variables button in the sidebar.
- clickHistory(): Promise<void> -- Clicks the history button in the sidebar.
- clickSettings(): Promise<void> -- Clicks the settings button in the sidebar.
- clickDownload(): Promise<void> -- Clicks the import/export button in the sidebar.
- getModelName(): Promise<string> -- Gets the current model name from the model selector.
- getRuntimeName(): Promise<string> -- Gets the current runtime from the status bar.
- expectModel(modelName: string): Promise<void> -- Verifies the model selector shows the expected model.
- expectRuntime(runtimeName: string): Promise<void> -- Verifies the runtime indicator shows the expected runtime.
- close(): Promise<void> -- Closes the Databot tab (tab is on the main page, not in the webview).

## dataExplorer (pages/dataExplorer.ts)
- maximize(showSummaryPanel: boolean = true): Promise<void> -- Maximize the data explorer by switching to stacked layout, closing sidebars and the
- waitForIdle(timeout = 60000): Promise<void> -- Wait until the data grid reports an idle status.
- expectStatusBarToHaveText(expectedText: string | RegExp, timeout = 15000): Promise<void> -- Assert that the status bar displays the expected text.

### dataExplorer.filters (pages/dataExplorer.ts)
- add(options: { columnName: string; condition: string; value?: string; metricRecord?: RecordMetric; metricTargetType?: MetricTargetType }): Promise<void> -- Add a filter to the data explorer. Only works for a single filter at the moment. Optionally record metric.
- clearAll() -- Clear all active column sorting and column filters, if any are present.

### dataExplorer.editorActionBar (pages/dataExplorer.ts)
- clickButton(buttonLabel: 'Convert to Code' | 'Clear Column Sorting' | 'Open as Plain Text File'): Promise<void> -- Click one of the named buttons in the editor action bar.
- expectToHaveButton(buttonName: string, isVisible: boolean = true) -- Assert that a button with the given name is visible (or not visible) in the editor
- verifyCanOpenAsPlaintext(searchString: string | RegExp) -- Click "Open as Plain Text File" and assert that the given text is visible in the

### dataExplorer.grid (pages/dataExplorer.ts)
- jumpToStart(): Promise<void> -- Press Cmd+Home (macOS) or Ctrl+Home (other platforms) to scroll the grid back to
- clickLowerRightCorner() -- Click the scrollbar corner widget at the lower-right of the data grid.
- clickUpperLeftCorner() -- Click the corner widget at the upper-left of the data grid (above row headers,
- sortColumnBy(columnIndex: number, sortBy: 'Sort Ascending' | 'Sort Descending' | 'Clear Sorting') -- Sort the specified column by the given sort option.
- clickCell(rowPosition: number, columnPosition: number, withShift = false) -- Click a cell by its visual position (position is 0-based) (See also: {@link clickCellByIndex} to click by stable data index (unaffected by sort/pin))
- clickCellByIndex(rowIndex: number, columnIndex: number, withShift = false) -- Click a cell by its index (Index is 0-based) (See also: {@link clickCell} to click by visual position (changes with sort/pin))
- shiftClickCell(rowIndex: number, columnIndex: number) -- Shift-click a cell by its visual position (Index is 0-based)
- selectColumnAction(colIndex: number, action: ColumnRightMenuOption) -- Select a column action from the right-click menu.
- pinColumn(colPosition: number) -- Pin a column by its position
- unpinColumn(colPosition = 0) -- Unpin a column by its position
- copyColumn(colPosition: number) -- Copy a column by its position
- pinRow(rowPosition: number) -- Pin a row by its position
- unpinRow(rowPosition = 0) -- Unpin a row by its position
- selectRange({ start, end }: { start: CellPosition; end: CellPosition }) -- Select a range of cells
- clickColumnHeader(columnTitle: string, options?: { button: 'left' | 'right' }) -- Click a column header by its title
- clickRowHeader(rowIndex: number) -- Click a row header by its position
- getRowCount(): Promise<number> -- Return the total number of rows as reported by the status bar.
- getColumnCount(): Promise<number> -- Return the total number of columns as reported by the status bar.
- getData(): Promise<object[]> -- Return all currently-visible grid data as an array of row objects keyed by column
- getColumnHeaders(): Promise<string[]> -- Return an array of all column header names currently visible in the grid.
- expectColumnHeadersToBe(expectedHeaders: string[]) -- Verify that the column headers match the expected headers.
- verifyTableDataLength(expectedLength: number) -- Assert that the number of rows returned by {@link getData} equals `expectedLength`.
- verifyTableDataRowValue(rowIndex: number, expectedData: CellData) -- Assert that the row at `rowIndex` in the grid data contains the expected cell values.
- expectCellContentAtIndexToBe(expectedContent: string, cellIndex?: number): Promise<void> -- Verify that the nth cell (default: last) has the expected content.
- expectCellContentToBe({ rowIndex, colIndex, value }: { rowIndex: number; colIndex: number; value: string | number }): Promise<void> -- Assert that the cell identified by its data indices contains the expected value. (See also: {@link clickCellByIndex} for clicking by stable data index, {@link expectCellContentAtIndexToBe} for checking by DOM order)
- expectRangeToBeSelected(expectedRange: { rows: number[]; cols: number[] }): Promise<void> -- Assert that the selection overlay covers exactly the given rows and columns.
- verifyTableData(expectedData: Array<{ [key: string]: string | number }>, timeout = 60000) -- Assert that the full grid data matches `expectedData` row by row and cell by cell.
- expectColumnsToBePinned(expectedTitles: string[]) -- Assert that only the given columns are pinned, in order.
- expectRowsToBePinned(expectedRows: number[], indexOffset = 0) -- Assert that the pinned row headers display the expected row numbers in order.
- expectColumnCountToBe(expectedCount: number) -- Assert that the number of column headers in the grid equals `expectedCount`.
- expectRowOrderToBe(expectedOrder: number[], indexOffset = 0) -- Assert that the row headers display the given row numbers in the given order.
- expectCellToBeSelected(row: number, col: number) -- Assert that the cell at the given visual position has the cursor-border overlay,

### dataExplorer.convertToCodeModal (pages/dataExplorer.ts)
- clickOK() -- Click the "Copy Code" button to confirm and dismiss the Convert to Code modal. (See also: {@link clickCancel} to dismiss without copying)
- clickCancel() -- Click the "Cancel" button to dismiss the Convert to Code modal without copying. (See also: {@link clickOK} to confirm and copy code)
- expectToBeVisible() -- Assert that the Convert to Code modal is visible, including the code box and both
- expectSyntaxHighlighting() -- Assert that the code in the modal has syntax highlighting active (more than one

### dataExplorer.summaryPanel (pages/dataExplorer.ts)
- hide(): Promise<void> -- Hide the summary panel using the keyboard shortcut. (See also: {@link show} to make the panel visible again)
- show(position: 'left' | 'right' = 'left'): Promise<void> -- Show the summary panel using the keyboard shortcut, docking it on the specified side. (See also: {@link hide} to hide the panel)
- search(filterText: string) -- Type a search term into the summary panel filter input and press Enter.
- clearSearch() -- Clear the search filter input in the summary panel.
- sortBy(sortBy: ColumnSort) -- Set the sort order of the summary panel via the context menu.
- clearSort() -- Reset the summary panel sort order to the original (unsorted) state.
- expandColumnProfile(rowNumber = 0): Promise<void> -- Toggle the expand/collapse icon for the column profile at the given row. (See also: {@link getColumnProfileInfo} to expand and read full profile data)
- waitForVectorHistogramVisible(timeout = 10000): Promise<void> -- Wait until at least one vector histogram sparkline is visible in the summary panel.
- hoverHistogramBinWithRange(expectedMin: string, expectedMax: string): Promise<void> -- Hover over histogram bins until a tooltip with the given min/max range is found.
- getColumnMissingPercent(rowNumber: number): Promise<string> -- Return the missing-value percentage text for the given summary panel row.
- getColumnProfileInfo(rowNumber: number): Promise<ColumnProfile> -- Expand the column profile for the given row, read all profile labels/values and (See also: {@link expandColumnProfile} to toggle without reading data)
- expectSortToBeBy(sortBy: ColumnSort) -- Assert that the summary panel sort button displays the given sort option.
- expectColumnCountToBe(count: number) -- Assert that the summary panel shows the expected number of column summaries.
- expectColumnNameToBe(columnProfileIndex: number, expectedName: string) -- Assert that the column summary at the given index displays the expected column name.
- expectColumnOrderToBe(columnNames: string[]) -- Assert that the summary panel column names appear in the exact given order.
- expectColumnToBe({ index, name, expanded }: { index: number; name: string; expanded: boolean }) -- Assert a single column summary entry by its index, checking both its name and
- expectScrollbarToBeVisible(visible = true) -- Assert that the summary panel vertical scrollbar is visible or not visible.
- verifyMissingPercent(expectedValues: Array<{ column: number; expected: string }>) -- Assert the missing-value percentage text for each specified summary panel row.
- expectColumnProfileToBeExpanded(columnProfileIndex: number) -- Assert that the column profile at `columnProfileIndex` is expanded (chevron-down, (See also: {@link expectColumnProfileToBeCollapsed})
- expectColumnProfileToBeCollapsed(columnProfileIndex: number) -- Assert that the column profile at `columnProfileIndex` is collapsed (chevron-right, (See also: {@link expectColumnProfileToBeExpanded})
- verifyColumnData(expectedValues: Array<{ column: number; expected: { [key: string]: string } }>) -- For each specified column, expand its profile and assert the label-value pairs match
- verifySparklineHoverDialog(verificationText: string[]): Promise<void> -- Hover over the first sparkline in the summary panel and assert that its tooltip
- verifySparklineHeights(expectedHeights: Array<{ column: number; expected: string[] }>) -- For each specified column, expand its profile and assert the sparkline bar heights
- verifyNullPercentHoverDialog(): Promise<void> -- Hover over the first null-percent indicator in the summary panel and assert that

## debug (pages/debug.ts)
- setBreakpointOnLine(lineNumber: number, index = 0): Promise<void>
- setUnverifiedBreakpointOnLine(lineNumber: number, index = 0): Promise<void> -- Set a breakpoint on a line and expect it to be initially unverified (gray)
- expectBreakpointVerified(index = 0, timeout = 30000): Promise<void> -- Wait for breakpoint to become verified (red)
- expectBreakpointUnverified(index = 0): Promise<void> -- Breakpoint is currently unverified (gray)
- clearBreakpoints(): Promise<void>
- unSetBreakpointOnLine(lineNumber: number, index = 0): Promise<void>
- startDebugging(): Promise<void>
- debugCell(): Promise<void>
- getVariables(): Promise<string[]>
- expectVariablesToExist(variables: { label: string; value: string }[]): Promise<void>
- stepOver(): Promise<any>
- stepInto(): Promise<any>
- stepOut(): Promise<any>
- continue(): Promise<any>
- getStack(): Promise<IStackFrame[]>
- selectCallStackAtIndex(stackPosition: number): Promise<void> -- select item in the call stack at the specified index
- expectDebugPaneToContain(variableLabel: string): Promise<void> -- The debug pane is visible and contains the specified variable
- expectDebugToolbarVisible(): Promise<void> -- The debug toolbar is visible
- expectDebugVariablePaneVisible(): Promise<void> -- The debug variable pane is visible
- expectCallStackAtIndex(stackPosition: number, item: string): Promise<void> -- The call stack is visible and contains the specified item at the specified position
- expectBrowserModeFrame(number: number): Promise<void> -- In browser mode at the specified frame
- expectCurrentLineToBe(lineNumber: number): Promise<void> -- the current line is the specified line number
- expectCurrentLineIndicatorVisible(timeout: number = 15000): Promise<void> -- the current line indicator is visible

## editor (pages/editor.ts)
- getEditorViewerFrame(): FrameLocator
- expectEditorViewerContentVisible( getLocator: (frame: FrameLocator) => Locator, options?: { timeout?: number } ): Promise<void> -- Wait for content to be visible in the editor viewer frame.
- type(text: string, pressEnter = false): Promise<void> -- Enter text in the editor
- selectTab(filename: string): Promise<void> -- Select tab by name
- selectTabAndType(filename: string, text: string): Promise<void> -- Select a file in the editor and enter text
- pressPlay(skipToastVerification: boolean = false): Promise<void>
- pressToLine(filename: string, lineNumber: number, press: string): Promise<void>
- getCurrentLineTop(): Promise<number> -- This function returns the top value of the style attribute for the editor's current-line div
- waitForEditorContents(filename: string, accept: (contents: string) => boolean, selectorPrefix = ''): Promise<any>
- waitForEditorFocus(filename: string, lineNumber: number, selectorPrefix = ''): Promise<void>
- clickOnTerm(filename: string, term: string, line: number, doubleClick: boolean = false): Promise<Locator>
- getLine(filename: string, line: number): Promise<string>
- replaceTerm(file: string, term: string, line: number, replaceWith: string)
- getMonacoFilenames(): Promise<string[]>

## editorActionBar (pages/editorActionBar.ts)
- clickButton(button: EditorActionBarButton): Promise<void> -- Click a specified button in the editor action bar.
- selectSummaryOn(isWeb: boolean, position: 'Left' | 'Right') -- Set the summary position to the specified side.
- clickCustomizeNotebookMenuItem(menuItem: string) -- Click a menu item in the "Customize Notebook" dropdown.
- verifySplitEditor(direction: 'down' | 'right', tabName: string,) -- Check that the editor is split in the specified direction (on the correct plane)
- verifyOpenInNewWindow(isWeb: boolean, text: string | RegExp, exact = true) -- Check that the "open in new window" contains the specified text
- verifyPreviewRendersHtml(heading: string) -- Check that the preview renders the specified heading
- verifyOpenViewerRendersHtml(isWeb: boolean, title: string) -- Check that the "open in viewer" renders the specified title
- verifySummaryPosition(position: 'Left' | 'Right') -- Check that the summary is positioned on the specified side
- verifyIsVisible(isVisible: boolean) -- the visibility of the editor action bar

## editors (pages/editors.ts)
- editorGroup(index: number): Locator -- Get a specific editor group by index.
- expectEditorGroupCount(count: number, timeout = 5000): Promise<void> -- the expected number of editor groups are visible.
- clickTab(tabName: string): Promise<void> -- click a tab by name without ensuring keyboard focus lands in the editor. (See also: {@link selectTab} to click a tab AND guarantee editor keyboard focus)
- runCurrentFile(): Promise<void> -- click the "Run in Console" or "Source R File" toolbar button to execute the
- verifyTab( tabName: string | RegExp, { isVisible = true, isSelected = true }: { isVisible?: boolean; isSelected?: boolean } ): Promise<void> -- a tab exists (or does not exist) and is selected (or is not selected).
- escapeRegex(s: string) -- Utility: escape a plain string so it can be used safely inside a `RegExp` constructor
- waitForActiveTab(fileName: string | RegExp, isDirty: boolean = false): Promise<void> -- the currently active (focused) tab matches the given file name and dirty state. (See also: {@link waitForActiveEditor} to additionally assert the editor textarea has focus, {@link waitForEditorFocus} to assert both the active tab and editor focus together)
- waitForActiveTabNotDirty(fileName: string): Promise<void> -- the active tab for `fileName` is visible and does NOT have the `dirty` CSS class. (See also: {@link waitForActiveTab} for the general-purpose variant)
- newUntitledFile(): Promise<void> -- open a new untitled file via the platform keyboard shortcut (Cmd+N / Ctrl+N)
- waitForEditorFocus(fileName: string): Promise<void> -- the tab for `fileName` is active AND the Monaco editor textarea for that file (See also: {@link waitForActiveTab} to check only the active tab, {@link waitForActiveEditor} to check only the editor focus)
- waitForActiveEditor(fileName: string): Promise<any> -- the Monaco editor instance for `fileName` has keyboard focus (its native edit (See also: {@link waitForActiveTab} to check the active tab instead, {@link waitForEditorFocus} to assert both the tab and editor focus together)
- selectTab(fileName: string): Promise<void> -- click a tab by file name and retry until the editor has keyboard focus. (See also: {@link clickTab} for a single click without focus guarantee)
- waitForTab(fileName: string | RegExp, isDirty: boolean = false): Promise<void> -- a tab with the given file name is visible in the tab bar (not necessarily active). (See also: {@link waitForSCMTab} to locate a tab by its `aria-label` prefix instead, {@link waitForActiveTab} to assert the tab is also the currently active one)
- waitForSCMTab(fileName: string): Promise<void> -- an SCM-managed tab whose `aria-label` starts with `fileName` is visible. (See also: {@link waitForTab} to locate a tab by its `data-resource-name` attribute)
- saveOpenedFile(): Promise<any> -- save the currently focused editor via the platform keyboard shortcut (Cmd+S / Ctrl+S).
- expectSuggestionListCount(count: number): Promise<void> -- the autocomplete suggestion widget contains exactly `count` visible items.
- expectEditorToContain(text: string): Promise<void> -- editor contains the specified text
- expectEditorGroupActive(index: number, timeout?: number): Promise<void> -- editor group at `index` has the `active` CSS class.
- expectEditorGroupInactive(index: number): Promise<void> -- editor group at `index` has the `inactive` CSS class.
- expectActiveEditorIconClassToMatch(iconClass: RegExp): Promise<void> -- the file-type icon in the active editor tab has a CSS class matching `iconClass`.

## explorer (pages/explorer.ts)
- verifyExplorerFilesExist(files: string[])

## extensions (pages/extensions.ts)
- searchForExtension(id: string): Promise<void>
- closeExtension(title: string): Promise<any>
- installExtension(id: string, waitUntilEnabled: boolean, attemptInstallOnly: boolean = false): Promise<void>

## help (pages/help.ts)
- openHelpPanel(): Promise<void>
- getHelpWelcomePageFrame()
- getHelpFrame(nth: number): Promise<FrameLocator>
- getHelpContainer(): Locator
- getHelpHeader(): Locator
- resizeHelpPanel(delta: { x?: number; y?: number }): Promise<void>

## hotKeys (pages/hotKeys.ts)
- copy()
- cut()
- paste()
- redo()
- selectAll()
- undo()
- executeNotebookCell()
- runFileInConsole()
- runLineOfCode()
- selectNotebookKernel()
- searchInNotebook()
- triggerGhostCell()
- openFile()
- save()
- openCommandPalette() -- Opens the command palette using a custom keybinding.
- closeAllEditors()
- closeTab()
- find()
- firstTab()
- scrollToTop()
- switchTabLeft()
- switchTabRight()
- killAllTerminals()
- focusConsole()
- visualMode()
- executeCodeInConsole()
- sendInterrupt()
- showSecondarySidebar()
- closeSecondarySidebar()
- fullSizeSecondarySidebar()
- stackedLayout()
- toggleBottomPanel()
- notebookLayout()
- closePrimarySidebar()
- minimizeBottomPanel()
- restoreBottomPanel()
- closeWorkspace()
- importSettings()
- jupyterCellAddTag()
- newFolderFromTemplate()
- openUserSettingsJSON()
- openWorkspaceSettingsJSON()
- reloadWindow(waitForReady = false)
- openWelcomeWalkthrough()
- resetWelcomeWalkthrough()
- openFolder()
- showDataExplorerSummaryPanel()
- hideDataExplorerSummaryPanel()
- showDataExplorerSummaryPanelRight()
- configureProviders()
- debugCell()
- clearAllBreakpoints()
- clearPlots()
- runCurrentQuartoCell()
- runCurrentQuartoCode()
- formatDocument()
- publishDocument()

## inlineDataExplorer (pages/inlineDataExplorer.ts)
- openFullDataExplorer(): Promise<void>
- sortColumn(columnName: string, direction: 'ascending' | 'descending'): Promise<void>
- scrollWithinGrid(deltaY: number): Promise<void>
- expectToBeVisible(timeout = DEFAULT_TIMEOUT): Promise<void>
- expectGridToBeReady(timeout = DEFAULT_TIMEOUT): Promise<void>
- expectShapeToContain(rows: number | string, columns?: number | string): Promise<void>
- expectColumnHeaderToBeVisible(headerText: string): Promise<void>
- expectOpenButtonToBeVisible(): Promise<void>
- expectTitleToBe(expectedTitle: string, timeout = DEFAULT_TIMEOUT): Promise<void>
- expectNoError(): Promise<void>
- expectCellValue( columnName: string, rowIndex: number, expectedValue: string | number, timeout = DEFAULT_TIMEOUT ): Promise<void>
- expectColumnToBeSorted( columnName: string, expectedFirstValues: (string | number)[], timeout = DEFAULT_TIMEOUT ): Promise<void>

## inlineQuarto (pages/inlineQuarto.ts)
- getInlineOutputAt(index: number): Locator
- getOutputContentAt(index: number): Locator
- getOutputItemAt(index: number): Locator
- getKernelText(): Promise<string>
- gotoLine(lineNumber: number): Promise<void>
- runCurrentCell({ via = 'hotkey' }: { via?: 'command' | 'hotkey' } = {}): Promise<void>
- runCurrentCode({ via = 'hotkey' }: { via?: 'command' | 'hotkey' } = {}): Promise<void>
- runAllCells(): Promise<void>
- clearAllOutputs(): Promise<void>
- runCellAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }: { cellLine: number; outputLine: number; timeout?: number }): Promise<void>
- runCodeAndWaitForOutput({ cellLine, outputLine, timeout = 120000 }: { cellLine: number; outputLine: number; timeout?: number }): Promise<void>
- clickToolbarRunButton(index = 0): Promise<void>
- clickToolbarCancelButton(): Promise<void>
- closeOutput(): Promise<void>
- copyOutput(): Promise<void>
- runCopyCommand(): Promise<void>
- popoutOutput(): Promise<void>
- runPopoutCommand(): Promise<void>
- selectStdoutTextViaDrag(): Promise<void>
- expectKernelToHaveText(name: string | RegExp, timeout = 30000): Promise<void>
- expectKernelStatusVisible(timeout = 30000): Promise<void>
- expectOutputsExist(count: number, timeout = 30000): Promise<void>
- expectOutputVisible({ index = 0, timeout = 30000 }: { index?: number; timeout?: number } = {}): Promise<void>
- expectOutputContentCount(count: number): Promise<void>
- expectOutputItemCount(count: number): Promise<void>
- expectErrorCount(count: number): Promise<void>
- expectHtmlOutputVisible(): Promise<void>
- expectWebviewOrHtmlVisible(timeout = 30000): Promise<void>
- expectStdoutContains(expectedText: string, timeout = 5000): Promise<void>
- expectOutputContainsText(text: string | RegExp, { index = 0, timeout = 10000 }: { index?: number; timeout?: number } = {}): Promise<void>
- expectOutputNotContainsText(text: string, { index = 0, timeout = 10000 }: { index?: number; timeout?: number } = {}): Promise<void>
- expectTextSelectedAndContains(expectedStrings: string[]): Promise<void>
- expectStdoutNotContains(forbiddenStrings: string[]): Promise<void>
- expectNoDataExplorerMetadata(): Promise<void>
- expectCopySuccess(timeout = 2000): Promise<void>
- expectCopySuccessReverted(timeout = 2000): Promise<void>
- expectKernelIdle(timeout = 30000): Promise<string>
- expectSingleVisibleToolbar(timeout = 15000): Promise<void>
- expectPendingExecution({ timeout }: { timeout?: number } = { timeout: 5000 }): Promise<void>

## layouts (pages/layouts.ts)
- enterLayout(layout: keyof typeof positronLayoutPresets): Promise<void> -- Enter a known positron layout.
- boundingBox(locator: Locator) -- A bounding box getting that errors if the element is not found rather than returning null.
- boundingBoxProperty(locator: Locator, property: 'x' | 'y' | 'width' | 'height') -- Get just a specific property of the bounding box. Errors if the element is not found.
- expectBottomPanelToBeVisible(visible = true): Promise<void> -- Assert that the bottom panel is visible or not visible.

## modals (pages/dialog-modals.ts)
- getButton(label: string | RegExp): Locator
- clickOk()
- clickCancel()
- clickButton(label: string | RegExp)
- installIPyKernel()
- installRenvModal(action: 'install' | 'cancel') -- Interacts with the Renv install modal dialog box. This dialog box appears when a user opts to
- expectMessageToContain(text: string | RegExp)
- expectToBeVisible(title?: string, { timeout = 30000, visible = true } = {})
- expectButtonToBeVisible(buttonLabel: string)
- expectToContainText(text: string | RegExp)

## newFolderFlow (pages/newFolderFlow.ts)
- createNewFolder(options: CreateFolderOptions) -- NEW FOLDER FLOW:
- setFolderTemplate(folderTemplate: FolderTemplate) -- Step 1. Select the folder template in the New Folder Flow.
- setFolderNameLocation(options: CreateFolderOptions) -- Step 2. Set the folder name and location in the New Folder Flow.
- setConfiguration(options: CreateFolderOptions) -- Step 3. Set the configuration in the New Folder Flow.
- getFolderTemplateLocatorMap() -- Helper: Retrieves a map of FolderTemplate to their locators in the New Folder Flow.
- clickFlowButton(action: FlowButton) -- Helper: Clicks the specified navigation button in the new folder flow.
- selectEnvProvider(providerToSelect: string) -- Helper: Selects the specified environment provider in the new folder flow environment provider dropdown.
- selectInterpreterByPath(interpreterPath: string) -- Helper: Selects the interpreter corresponding to the given path in the new folder flow interpreter dropdown.
- expectFolderTemplatesToBeVisible(visibleTemplates: Partial<Record<FolderTemplate, boolean>> = {}, closeModal = true)
- verifyFolderCreation(folderName: string)

## notebooks (pages/notebooks.ts)
- selectInterpreter( kernelGroup: 'Python' | 'R', desiredKernel = kernelGroup === 'Python' ? process.env.POSITRON_PY_VER_SEL! : process.env.POSITRON_R_VER_SEL! )
- expectKernelToBe(kernelName: string)
- createNewNotebook()
- openNotebook(path: string)
- addCodeToCellAtIndex(cellIndex: number, code: string, delay = 0)
- hoverCellText(cellIndex: number, text: string)
- executeCodeInCell()
- assertCellOutput(text: string | RegExp, cellIndex?: number, { timeout = 15000 } = {}): Promise<void>
- closeNotebookWithoutSaving()
- expectMarkdownTagToBe(tag: string, expectedText: string): Promise<void>
- runAllCells({ timeout = 15000 } = {}): Promise<void>
- focusFirstCell()
- deleteAllCells()
- typeInEditor(text: string, delay = 0): Promise<any>
- waitForActiveCellEditorContents(contents: string): Promise<string>
- insertNotebookCell(kind: 'markdown' | 'code'): Promise<void>
- selectCellAtIndex(cellIndex: number): Promise<void>
- stopEditingCell()
- executeActiveCell(): Promise<void>

## notebooksPositron (pages/notebooksPositron.ts)
- scopedTo(container: Locator): ScopedNotebook -- Returns a scoped version of the notebook for use with side-by-side notebooks.
- getCellCount(): Promise<number> -- Get cell count.
- getCellContent(cellIndex: number): Promise<string[]> -- Get markdown cell content lines at specified index.
- getFocusedCellIndex(): Promise<number | null> -- Get the index of the currently focused cell.
- getCellType(cellIndex: number): Promise<'code' | 'markdown'> -- Get the type of cell at the specified index.
- enablePositronNotebooks( settings: { set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>; }, ) -- Enable Positron notebooks as the default editor.
- disablePositronNotebooks( settings: { set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>; }, ) -- Disable Positron notebooks as the default editor.
- openNotebook(path: string): Promise<void> -- Open a Positron notebook.
- newNotebook({ codeCells = 0, markdownCells = 0, language, clearCells = false, }: { codeCells?: number; markdownCells?: number; language?: 'Python' | 'R'; clearCells?: boolean; } = {}): Promise<void> -- Create a new Positron notebook.
- clickActionBarButtton(buttonName: EditorActionBarButtons): Promise<void> -- Click a button in the editor action bar.
- clickAwayFromCell(cellIndex: number) -- Click away from a cell to defocus it.
- addCell(type: 'code' | 'markdown'): Promise<void> -- Add a new cell of the specified type.
- selectCellAtIndex( cellIndex: number, { editMode = undefined }: { editMode?: boolean } = {} ): Promise<void> -- Select a cell at the specified index.
- triggerCellAction(cellIndex: number, action: MoreActionsMenuItems): Promise<void> -- Select an action from the More Actions menu for a specific cell.
- dragCellToPosition(fromIndex: number, toIndex: number): Promise<void> -- Drag a cell from one position to another using the drag handle.
- startDragCell(cellIndex: number): Promise<void> -- Start dragging a cell (without releasing). Useful for testing drag cancellation.
- dragCellToPositionWithScroll(fromIndex: number, toIndex: number): Promise<void> -- Drag a cell to a position that requires auto-scrolling.
- hoverCell(cellIndex: number): Promise<void> -- Hover over a cell to show the drag handle.
- triggerCellOutputAction(cellIndex: number, button: OutputActionBarButtons): Promise<void> -- Select an output action from the Output Action Bar for a cell.
- runCodeAtIndex(cellIndex = 0): Promise<void> -- Run the code in the cell at the specified index.
- runCellAtIndex(cellIndex = 0): Promise<void> -- Run the cell at the specified index, regardless of type.
- editModeAtIndex(cellIndex: number): Promise<void> -- Enter edit mode for the cell at the specified index.
- addCodeToCell( cellIndex: number, code: string, options?: { delay?: number; run?: boolean; waitForSpinner?: boolean; type?: 'code' | 'markdown' } ): Promise<Locator> -- Add code to a cell at the specified index and run it.
- performCellAction(action: 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'delete' | 'addCellBelow' | 'changeToCode' | 'changeToMarkdown' | 'changeToRaw'): Promise<void> -- Perform a cell action using keyboard shortcuts.
- deleteCellWithActionBar(cellIndex = 0): Promise<void> -- Delete a cell using the action bar button.
- clickFixErrorButton(): Promise<void> -- Click the "Ask assistant to fix" button on an error cell.
- clickExplainErrorButton(): Promise<void> -- Click the "Ask assistant to explain" button on an error cell.
- clickAskAssistantButton(): Promise<void> -- Click the "Ask Assistant" button in the editor action bar.
- search( searchText: string, options?: { replaceText?: string; replaceAll?: boolean; enterKey?: boolean } ): Promise<void> -- Search Notebook.
- searchNext(mode: 'button' | 'keyboard' = 'button'): Promise<void> -- Click the 'Next Match' button in the search widget.
- searchPrevious(): Promise<void> -- Click the 'Previous Match' button in the search widget.
- searchClose(mode: 'button' | 'keyboard' = 'button'): Promise<void> -- Close the search widget.
- searchExpandReplace(): Promise<void> -- Expand the replace row in the search widget.
- expectReplaceRowVisible(visible: boolean = true): Promise<void> -- Replace row is visible or hidden.
- expectAssistantButtonsVisible(visible: boolean = true): Promise<void> -- Assistant buttons visibility.
- expectErrorAssistantButtonsVisible(visible: boolean = true): Promise<void> -- Fix/Explain error buttons visibility.
- expectNotebookErrorVisible(timeout: number = 10000): Promise<void> -- A notebook error is visible in any cell.
- expectSearchCountToBe({ current, total }: { current?: number; total: number }): Promise<void> -- search count matches expected count.
- expectSearchDecorationCountToBe(expectedCount: number): Promise<void> -- search decoration count matches expected count.
- expectToBeVisible(timeout = DEFAULT_TIMEOUT): Promise<void> -- a Positron notebook is visible on the page.
- expectCellCountToBe(expectedCount: number): Promise<void> -- Cell count matches expected count.
- expectCellContentsToBe(expectedContents: string[]): Promise<void> -- Cell contents match expected contents.
- expectCellTypeAtIndexToBe(cellIndex: number, expectedType: 'code' | 'markdown' | 'raw'): Promise<void> -- Cell type at specified index matches expected type.
- expectCellContentAtIndexToBe(cellIndex: number, expectedContent: string | string[]): Promise<void> -- Cell content at specified index matches expected content.
- expectFooterToContain( cellIndex: number, expectedContent: { duration?: RegExp; status?: 'Cell execution succeeded' | 'Cell execution failed' | 'Cell is executing' | 'Cell is queued for execution'; completed?: RegExp }, timeout = DEFAULT_TIMEOUT ): Promise<void> -- Cell footer contains expected execution info.
- expectFooterAriaLabel(cellIndex: number, expectedAriaLabel: string, timeout = DEFAULT_TIMEOUT): Promise<void> -- Cell footer has the expected aria-label.
- expectExecutionStatusToBe(cellIndex: number, expectedStatus: 'running' | 'idle' | 'failed' | 'success', timeout = DEFAULT_TIMEOUT): Promise<void> -- Cell execution status matches expected status.
- expectExecutionOrder(executionOrders: { index: number; order: number | undefined }[]): Promise<void> -- Execution order for multiple cells.
- expectSpinnerAtIndex(cellIndex: number, visible = true, timeout = DEFAULT_TIMEOUT): Promise<void> -- Spinner visibility in a cell.
- expectNoActiveSpinners(timeout = DEFAULT_TIMEOUT): Promise<void> -- No active spinners are present.
- expectCellsToBeSelected(expectedIndices: number[], timeout = DEFAULT_TIMEOUT): Promise<void> -- multiple cells are selected.
- expectDragHandleVisibility(cellIndex: number, visible: boolean, timeout = DEFAULT_TIMEOUT): Promise<void> -- drag handle visibility state for a cell.
- expectCellIndexToBeSelected( expectedIndex: number, options?: { isSelected?: boolean; inEditMode?: boolean; isActive?: boolean; timeout?: number } ): Promise<void> -- the cell at the specified index is (or is not) selected,
- expectCellToHaveLineCount({ cellIndex, numLines }): Promise<void> -- the cell at the specified index has the expected number of lines.
- expectScreenshotToMatch(index: number, screenshotName: string): Promise<void> -- Screenshot of rendered markdown at specified index matches expected screenshot.
- expectMarkdownTagToBe(tag: string, expectedText: string): Promise<void> -- markdown text for a specific tag matches expected text.
- expectOutputAtIndex(cellIndex: number, lines: string[]): Promise<void> -- cell output at specified index matches expected output.
- expectCellToBeVisibleInViewport( cellIndex: number, options?: { edge?: 'top' | 'bottom' } ): Promise<void> -- the cell at the specified index is fully visible within the
- expectActionBarVisibleInViewport(cellIndex: number): Promise<void> -- the action bar for the cell at the specified index is not clipped
- expectGhostCellGenerationVisible(): Promise<void> -- "Generating suggestion..." message is visible.
- expectGhostCellVisible(): Promise<void> -- Ghost cell is visible with all expected components.
- expectGhostCellMode(automatic: boolean): Promise<void> -- Ghost cell mode is set to the expected value.
- expectGhostCellAwaitingRequest(): Promise<void> -- "AI suggestion available on request" UI is visible.
- expectGhostCellToContainText(expectedText: string): Promise<void> -- Ghost cell contains expected text.
- expectGhostCellNotVisible(): Promise<void> -- Ghost cell is not visible.
- expectGhostCellOptInVisible(): Promise<void> -- Ghost cell opt-in prompt is visible.
- expectGhostCellOptInNotVisible(): Promise<void> -- Ghost cell opt-in prompt is not visible.
- expectGhostCellInfoDialogContent(expectations: string[]): Promise<void> -- Ghost cell info dialog content matches expectations.
- expectGhostCellInfoDialogElement(selector: string): Promise<void> -- A specific element exists within the ghost cell info dialog.
- closeGhostCellInfoDialog(): Promise<void> -- Close the ghost cell info dialog by clicking "Got it".
- selectGhostCellMode(automatic: boolean): Promise<void> -- Select ghost cell mode.
- acceptGhostCellSuggestion(): Promise<void> -- Accept ghost cell suggestion (clicks Accept and Run).
- getSuggestion(): Promise<void> -- Request a suggestion by clicking "Get Suggestion" button.
- dismissGhostCellSuggestion(): Promise<void> -- Dismiss the current ghost cell suggestion.
- clickGhostCellInfoButton(): Promise<void> -- Click the ghost cell info button to open the info dialog.
- enableGhostCellSuggestions(): Promise<void> -- Click "Enable" on the ghost cell opt-in prompt.
- dismissGhostCellOptIn(): Promise<void> -- Click "Not now" on the ghost cell opt-in prompt.
- disableGhostCellOptIn(): Promise<void> -- Click "Don't ask again" on the ghost cell opt-in prompt.
- getScrollTop(): Promise<number> -- Get the current scroll position of the notebook cells container.

## notebooksVscode (pages/notebooksVscode.ts)
- expectToBeVisible(timeout = 25000): Promise<void> -- a VS Code notebook is visible on the page.

## outline (pages/outline.ts)
- focus(): Promise<void>
- getOutlineData(): Promise<string[]>
- expectOutlineElementToBeVisible(text: string, visible = true): Promise<void>
- expectOutlineToBeEmpty(): Promise<void>
- expectOutlineElementCountToBe(count: number): Promise<void>
- clickOutlineElement(text: string): Promise<void> -- Click an outline element by its label text.
- expectOutlineToContain(expected: string[]): Promise<void>

## output (pages/output.ts)
- openOutputPane(outputPaneNameContains: string)
- clickOutputTab()
- waitForOutContaining(fragment: string)
- scrollToTop(): Promise<void> -- Scroll to the top of the output pane
- copySelectedText(): Promise<string> -- Copy selected text from the output pane and return it
- selectFirstNLines(lineCount: number): Promise<void> -- Select the first N lines of output text

## packages (pages/packages.ts)
- open(): Promise<void> -- Open the Packages pane in the sidebar.
- selectPackage(name: string): Promise<void> -- Click a package row by name to select it.
- rightClickPackage(name: string, menuItem: string): Promise<void> -- Right-click a package and choose a context menu item.
- refresh(): Promise<void> -- Click the Refresh Packages button.
- getPackageCount(): Promise<number> -- Get the count of visible package items.
- getPackageNames(): Promise<string[]> -- Get all visible package names as an array.
- getSessionLabel(): Promise<string> -- Get the session label text (e.g. "Python 3.10.15 (Pyenv)", "R 4.4.2").
- expectPackageToBeVisible(name: string, visible = true): Promise<void> -- A package with the given name is visible (or not visible) in the list.
- expectPackageCountGreaterThan(count: number): Promise<void> -- The package count is at least the given number.
- expectPackageToBeSelected(): Promise<void> -- The selected package row is highlighted.
- expectSessionLabelToContain(text: string): Promise<void> -- The session label contains the expected text.
- expectToBeVisible(): Promise<void> -- The Packages pane is visible in the sidebar.

## plots (pages/plots.ts)
- clickSessionNameButton() -- Click the session name button displayed on the current plot.
- clickOriginFileButton() -- Click the origin file button to navigate to the source file.
- waitForCurrentPlot() -- Wait for any plot to appear in the Plots pane. (See also: waitForPlotInFullSizeViewer for plots opened in the full-size editor viewer only, expectCurrentPlotVisible to assert the plot is visible as a test verification)
- expectCurrentPlotVisible() -- A plot is visible in the Plots pane. (See also: waitForCurrentPlot to wait for a plot before interacting with it)
- waitForPlotInFullSizeViewer() -- Wait for a static (non-webview) plot image in the full-size plot viewer. (See also: waitForCurrentPlot for general plot detection (sidebar + editor), expectPlotInFullSizeViewerVisible to assert the static plot is visible as a test verification)
- expectPlotInFullSizeViewerVisible() -- A static (non-webview) plot image is visible in the full-size plot viewer. (See also: waitForPlotInFullSizeViewer to wait for a static plot before interacting with it)
- expectOriginButtonVisible() -- The origin file button is visible in the Plots pane.
- expectOriginButtonContain(text: string) -- The origin file button contains the expected text.
- getWebviewPlotLocator(selector: string): Locator -- Get a locator for an element inside a webview plot.
- getDeepWebWebviewPlotLocator(selector: string): Locator -- Get a locator for an element inside a deeply nested webview plot.
- waitForWebviewPlot(selector: string, state: 'attached' | 'visible' = 'visible', RWeb = false) -- Wait for a webview-based plot to appear. (See also: waitForCurrentPlot for static image plots (matplotlib, ggplot2))
- clearPlots() -- Clear all plots from the Plots pane. No-op if no plots exist.
- waitForNoPlots({ timeout = 15000 }: { timeout?: number } = {}) -- No plots are visible in the Plots pane. (See also: expectNoPlots to assert no plots are visible as a test verification)
- expectNoPlots({ timeout = 15000 }: { timeout?: number } = {}) -- No plots are visible in the Plots pane. (See also: waitForNoPlots to wait for plots to disappear before proceeding)
- getCurrentPlotAsBuffer(): Promise<Buffer> -- Capture the current plot as a screenshot buffer.
- getFullSizeViewerPlotAsBuffer(): Promise<Buffer> -- Capture the current static plot as a screenshot buffer. (See also: getCurrentPlotAsBuffer for the general version)
- copyCurrentPlotToClipboard() -- Click the copy-to-clipboard button on the current plot.
- savePlotFromPlotsPane({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) -- Save the current plot from the Plots pane sidebar. (See also: savePlotFromEditor to save from an editor tab instead)
- savePlotFromEditor({ name, format, overwrite = true }: { name: string; format: 'JPEG' | 'PNG' | 'SVG' | 'PDF' | 'TIFF'; overwrite?: boolean }) -- Save the current plot from the editor tab. (See also: savePlotFromPlotsPane to save from the sidebar instead)
- clickGoToFileButton() -- Click the "Go to file" button on the current plot.
- setThePlotZoom(zoomLevel: ZoomLevels) -- Set the zoom level for the current plot.
- openPlotIn(plotLocation: PlotLocations) -- Open the current plot in a specified location.
- clickOpenInEditorButton() -- Click the main "Open in editor tab" button (no dropdown).
- verifyOpenPlotDropdownCheckedOption(expectedOption: PlotLocations) -- The "Open in Editor" dropdown has the expected option checked.
- waitForPlotInEditor() -- Wait for a plot image to appear in an editor tab (not the sidebar). (See also: expectPlotInEditorVisible to assert the plot is visible as a test verification)
- expectPlotInEditorVisible() -- A plot image is visible in an editor tab (not the sidebar). (See also: waitForPlotInEditor to wait for a plot in the editor before interacting with it)
- expectPlotThumbnailsCountToBe(count: number) -- The expected number of plot thumbnails are visible.
- enlargePlotArea() -- Enlarge the Plots pane area by dragging sashes inward.
- restorePlotArea() -- Restore the Plots pane area to its original size after enlarging.
- alterPlotArea(xDelta: number, yDelta: number) -- Resize the Plots pane area by dragging sashes.

## popups (pages/dialog-popups.ts)
- getPopupItem(label: string | RegExp): Locator
- clickItem(label: string | RegExp)

## positConnect (pages/connect.ts)
- setConnectApiKey(key: string)
- getConnectApiKey()
- createUser(): Promise<string>
- getPythonVersions(): Promise<string[]>
- getUserId(username: string): Promise<string | undefined>
- setPythonVersion(version: string)
- setContentPermission( contentGuid: string, payload: PermissionPayload, ): Promise<PermissionResponse>

## problems (pages/problems.ts)
- showProblemsView(): Promise<any> -- Show the Problems view
- expectSquigglyCountToBe(severity: ProblemSeverity, count: number): Promise<void> -- Expect the number of squigglies to be as specified
- expectDiagnosticsToBe({ badgeCount, errorCount, warningCount, timeout = TIMEOUT_STANDARD }: { badgeCount?: number; errorCount?: number; warningCount?: number; timeout?: number; }): Promise<void> -- Expect the number of problems, errors, and warnings to be as specified
- expectWarningText(text: string): Promise<void> -- Expect the warning text to be present in the Problems view

## quickaccess (pages/quickaccess.ts)
- openDataFile(path: string): Promise<void>
- openFileQuickAccessAndWait( searchValue: string, expectedFirstElementNameOrExpectedResultCount: string | number ): Promise<void>
- openFile(path: string, waitForFocus = true): Promise<void>
- runCommand(commandId: string, options?: { keepOpen?: boolean; exactLabelMatch?: boolean }): Promise<void>
- openQuickOutline({ timeout = 30000 }): Promise<void>

## quickInput (pages/quickInput.ts)
- expectTitleBarToHaveText(text: string): Promise<void>
- expectQuickInputResultsToContain(titles: string[]): Promise<void>
- waitForQuickInputOpened({ timeout = 3000, }: { timeout?: number } = {}): Promise<void>
- type(value: string): Promise<void>
- waitForQuickInputElementText(): Promise<string>
- closeQuickInput(): Promise<void>
- waitForQuickInputElements( accept: (names: string[]) => boolean, ): Promise<void>
- waitForQuickInputClosed(): Promise<void>
- selectQuickInputElement( index: number, keepOpen?: boolean, ): Promise<void>
- selectQuickInputElementContaining( text: string, { timeout, force = true }: { timeout?: number; force?: boolean } = {}, ): Promise<string>
- clickOkButton(): Promise<void>

## references (pages/references.ts)
- waitUntilOpen(): Promise<void>
- waitForReferencesCountInTitle(count: number): Promise<void>
- waitForReferencesCount(count: number): Promise<void>
- waitForFile(file: string): Promise<void>
- waitForReferenceFiles(files: string[]): Promise<void>
- close(): Promise<void>

## scm (pages/scm.ts)
- openSCMViewlet(): Promise<any>
- waitForChange(name: string, type: 'Staged' | 'Modified'): Promise<void>
- openChange(name: string): Promise<void>
- stage(name: string): Promise<void>
- commit(message: string): Promise<void>
- verifyCurrentHistoryItem(name: string): Promise<void>

## search (pages/search.ts)
- openSearchViewlet(): Promise<any>
- clearSearchResults(): Promise<void>
- waitForNoResultText(): Promise<void>
- searchFor(value: string): Promise<any>
- waitForResultText(text: string): Promise<void>
- setFilesToIncludeText(text: string): Promise<void>
- showQueryDetails(): Promise<void>
- hideQueryDetails(): Promise<void>
- removeFileMatch(filename: string): Promise<void>

## sessions (pages/sessions.ts)
- start<T extends SessionRuntimes | SessionRuntimes[]>( sessions: T, options?: { triggerMode?: SessionTrigger; reuse?: boolean; } ): Promise<T extends SessionRuntimes ? SessionMetaData : { [K in keyof T]: SessionMetaData }> -- Starts one or more sessions
- delete(sessionId: string): Promise<void> -- Delete the session via trash button
- restart(sessionIdOrName: string, options?: { waitForIdle?: boolean; clearConsole?: boolean; clickModalButton?: string }): Promise<void> -- Restart the session
- selectMetadataOption(menuItem: 'Show Kernel Output Channel' | 'Show Supervisor Output Channel' | 'Show LSP Output Channel') -- Open the metadata dialog and select the desired menu item
- deleteDisconnectedSessions() -- Delete all disconnected sessions
- deleteAll() -- Delete all sessions
- clearConsoleAllSessions() -- Clear the Console for all active Sessions
- setSessionDividerAboveBottom(distanceFromBottom: number = 100) -- Move the session tab list divider to a specific position from the bottom of the window.
- resizeSessionList(options: { x?: number; y?: number }) -- Resize the session tab list by dragging a sash.
- select(sessionIdOrName: string, waitForSessionIdle = false): Promise<void> -- Select the session
- getSessionCount(): Promise<number> -- Helper: Get the number of sessions in the console
- startAndSkipMetadata(options: { language: 'Python' | 'R'; version?: string; disambiguator?: string; triggerMode?: 'session-picker' | 'quickaccess' | 'hotkey'; waitForReady?: boolean; }): Promise<string> -- Helpers: Start a new session via the session picker button, quickaccess, or console session button.
- getSelectedSessionInfo(): Promise<Omit<ExtendedSessionInfo, 'id'>> -- Helper: Get the interpreter info for the currently selected runtime via the quickpick menu.
- expectNoStartUpMessaging() -- Helper: Wait for runtimes to finish loading
- getAllSessionIds(): Promise<string[]> -- Helper: Get all session IDs for sessions in the console
- getAllSessionIdsAndNames(): Promise<{ id: string; name: string }[]> -- Helper: Get all session IDs and their names for sessions in the console
- getCurrentSessionId(): Promise<string> -- Helper: Get the session ID for the currently selected session
- getMetadata(sessionId?: string): Promise<SessionMetaData> -- Helper: Get the metadata of the session
- getActiveSessions(): Promise<QuickPickSessionInfo[]> -- Helper: Get Active Sessions in the Console Session Tab List
- getIconStatus(sessionIdOrName: string): Promise<'active' | 'idle' | 'disconnected' | 'exited' | 'unknown'> -- Helper: Get the icon status of the session tab
- rename(oldName: string, newName: string) -- Rename a session via command
- renameViaUI(sessionId: string, newName: string): Promise<void> -- Rename a session via UI
- deleteViaUI(sessionId: string): Promise<void> -- Delete a session via UI
- openMetadataDialog() -- Open the metadata dialog for the current session
- expectStatusToBe(sessionIdOrName: string, expectedStatus: 'active' | 'starting' | 'idle' | 'disconnected' | 'exited', options?: { timeout?: number }) -- Check the status of the session
- expectSessionNameToBe(sessionId: string, expectedName: string) -- Check the name of the session
- expectMetadataToBe(session: SessionMetaData) -- Check the metadata of the session dialog
- expectSessionPickerToBe(runtimeName: string | RegExp, options?: { status?: SessionState; timeout?: number }) -- the runtime matches the runtime in the Session Picker button
- expectSessionCountToBe(count: number, sessionType: 'all' | 'active' = 'all') -- the session count in the console
- expectActiveSessionListsToMatch() -- the active sessions match between console and session picker
- expectSessionListToBeScrollable(options: { horizontal?: boolean; vertical?: boolean } = {}) -- the session list is scrollable
- expectAllSessionsToBeReady({ timeout = 15000 }: { timeout?: number } = {}) -- all sessions are "ready" (idle or disconnected)
- expectStartNewSessionMenuToBeVisible() -- Start a New Session menu is visible
- expectConsoleSessionToBeSelected(sessionIdOrName: string | RegExp) -- the session is selected in the console tab list
- expectSessionQuickPickToContainInRelativeOrder(sessionList: { session: SessionMetaData }[]) -- the session quick pick contains the given session entries in the specified order,

## settings (pages/userSettings.ts)
- mergeSetting(settings: Record<string, unknown>): Promise<void> -- Sets the provided settings by merging with existing settings.
- remove(keysToRemove: string[]): Promise<void> -- Removes the specified keys from the settings.
- getSettings(): Promise<Record<string, unknown>> -- Gets all user settings as an object.
- clear(): Promise<void> -- Clears all settings (resets to empty object).
- backup(): Promise<string> -- Backs up the current settings as a string.
- restore(settings: string): Promise<void> -- Restores the settings from a string.
- set(settings: Record<string, unknown>, options?: { keepOpen: boolean }): Promise<void> -- Write settings to disk, then open/save/close the file in the editor to trigger reload.

## sideBar (pages/sideBar.ts)
- closeSecondarySideBar()
- openSession()

## terminal (pages/terminal.ts)
- sendKeysToTerminal(key: string)
- clickTerminalTab()
- waitForTerminalText( terminalText: string, options: { timeout?: number; expectedCount?: number; web?: boolean; } = {} ): Promise<string[]>
- waitForTerminalLines()
- createTerminal(): Promise<void>
- runCommandInTerminal(commandText: string): Promise<void>
- sendTextToTerminal(text: string)
- logTerminalContents()
- handleContextMenu(locator: Locator, action: 'Select All' | 'Copy' | 'Paste') -- Right clicks and selects a menu item, waiting for menu dismissal.

## testExplorer (pages/testExplorer.ts)
- getTestResults(): Promise<object> -- Constructs a object containing test results from the test explorer.
- openTestExplorer(): Promise<void> -- Clicks the test explorer icon
- verifyTestFilesExist(files: string[])
- runAllTests(): Promise<void> -- Clicks to run all tests in the test explorer

## toasts (pages/dialog-toasts.ts)
- getOptionButton(button: string): Locator
- waitForAppear(title?: string | RegExp, { timeout = 20000 } = {})
- waitForDisappear(title?: string | RegExp, { timeout = 20000 } = {})
- clickButton(button: string)
- closeAll()
- closeWithText(message: string)
- closeWithHeader(header: string | RegExp)
- expectToastWithTitle(title?: string | RegExp, timeoutMs = 3000)
- expectToastWithTitleNotToAppear(title: string | RegExp, timeoutMs = 5000)
- expectImportSettingsToastToBeVisible(visible = true)
- expectNotToBeVisible(timeoutMs = 3000)
- awaitToastDisappearance(timeoutMs = 3000)

## topActionBar (pages/topActionBar.ts)
- (no public methods found)

## variables (pages/variables.ts)
- getFlatVariables(): Promise<Map<string, FlatVariables>> -- Collect all visible variables in the current group into a flat map keyed by name.
- focusVariablesView() -- Focus the Variables panel using the keyboard shortcut.
- waitForVariableRow(variableName: string): Promise<Locator> -- Wait for a variable row to become visible and return its locator.
- openVariableInDataExplorer(variableName: string) -- Double-click a variable row to open it in the Data Explorer. (See also: clickDatabaseIconForVariableRow for the icon-based alternative, which can be unreliable)
- hasProgressBar(): Promise<boolean> -- Check whether the variables panel is currently showing a progress bar (loading state).
- toggleVariable({ variableName, action }: { variableName: string; action: 'expand' | 'collapse' }) -- Expand or collapse a variable row by clicking its chevron icon. (See also: expandVariable, collapseVariable)
- expandVariable(variableName: string) -- Expand a variable row to reveal its children. No-ops if already expanded. (See also: collapseVariable, toggleVariable)
- collapseVariable(variableName: string) -- Collapse a variable row to hide its children. No-ops if already collapsed. (See also: expandVariable, toggleVariable)
- getVariableChildren(parentVariable: string, collapseParent = true): Promise<{ [key: string]: { value: string; type: string } }> -- Gets the data (value and type) for the children of a parent variable.
- getCurrentVariablesGroup(): Promise<string> -- Return the label of the currently selected variables group.
- selectSession(name: string) -- Select a session in the variables pane.
- selectVariablesGroup(name: string) -- Switch the variables panel to a different group (e.g. "Globals", "Locals"). (See also: selectSession for switching between interpreter sessions)
- getVariablesGroupList() -- Open the variables group dropdown and return all available group names.
- setFilterText(filterText: string) -- Type text into the variables filter input to narrow the displayed variable list.
- clickDatabaseIconForVariableRow(rowName: string) -- Click the database icon on a variable row to open it in the Data Explorer. (See also: openVariableInDataExplorer for the reliable alternative)
- clickSessionLink() -- Click the "Session" link in the active view switcher to navigate to the session panel.
- deleteAllVariables() -- Click the "Delete all objects" button and confirm the modal dialog if it appears.
- expectRuntimeToBe(expectation: 'visible' | 'not.visible', sessionName: string | RegExp) -- Confirm the runtime is visible in the variables pane.
- expectVariableToBe(variableName: string, value: string | RegExp, timeout: number = 15000) -- Confirm the variable is visible and has the expected value.
- expectVariableToNotExist(variableName: string) -- Confirm that a variable does NOT appear in the current variables group. (See also: expectVariableToBe for asserting a variable exists with a specific value)
- expectSessionToBe(sessionName: string | RegExp) -- Confirm the session is selected in the variables pane.
- expectMemoryMeterReady() -- Wait for the memory meter to be visible and showing a real value (not loading state).
- openMemoryDropdown() -- Open the memory usage dropdown by clicking the memory meter.
- closeMemoryDropdown() -- Close the memory usage dropdown by pressing Escape.
- expectSessionsInMemoryDropdown(sessions: Record<string, boolean>) -- Verify sessions appear (or do not appear) in the memory usage dropdown.

## viewer (pages/viewer.ts)
- getViewerLocator(locator: string): Locator
- getViewerFrame(): FrameLocator
- refreshViewer()
- clearViewer()
- openViewerToEditor()
- expectViewerPanelVisible(timeout = 10000): Promise<void>
- expectUrlToHaveValue(expectedUrl: string, timeout = 10000): Promise<void>
- expectContentVisible( getLocator: (frame: FrameLocator) => Locator, options?: { timeout?: number; onRetry?: () => Promise<void>; useIframe?: boolean } ): Promise<void> -- Wait for content to be visible in the viewer frame, with retry on failure.
- expectContentNotVisible(getLocator: (frame: FrameLocator) => Locator, timeout = 10000): Promise<void>

## welcome (pages/welcome.ts)
- expectLogoToBeVisible()
- expectFooterToBeVisible()
- expectTabTitleToBe(title: string)
- expectConnectToBeVisible(visible: boolean)
- expectStartToContain(startButtons: string[])
- expectHelpToContain(helpButtons: string[])
- expectRecentToContain(recentItems: string[])
- expectWalkthroughsToContain(walkthroughs: string[])
- expectWalkthroughsToHaveCount(count: number)
