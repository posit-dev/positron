# Positron MCP API Exposure Development Plan

## Current Development Status (2025-01-15)

### ✅ Phase 1: COMPLETED
- **Core Runtime APIs**: All implemented and functional
- **API Wrapper**: Complete interface-first implementation  
- **MCP Tools**: execute-code, get-active-document, get-workspace-info
- **Type Definitions**: Complete for all Phase 1-3 APIs

### ✅ Phase 0: COMPLETED (2025-01-15)
- **Security Middleware**: MinimalSecurityMiddleware class implemented
- **CORS Protection**: Restricted to localhost origins only
- **User Consent**: Modal dialogs for code execution approval
- **Audit Logging**: Comprehensive request/response/security event logging
- **Rate Limiting**: Configurable request throttling
- **Request Validation**: JSON-RPC format and size validation
- **Security Commands**: Reset consent, view/clear audit log

---

## Executive Summary

This document outlines the complete plan for exposing the appropriate Positron extension API surface area to the positron-mcp extension. The goal is to create a clean, type-safe, and extensible interface that allows AI tools to interact with Positron's core functionality through the Model Context Protocol (MCP).

### Current State (Updated 2025-01-15)
- ✅ Full MCP server implemented with Phase 1 tools
- ✅ Complete API wrapper (`PositronApiWrapper`) with all Phase 1 APIs
- ✅ Six functional MCP tools: `execute-code`, `get-active-document`, `get-workspace-info`, `foreground-session`, `get-variables`, `get-time`
- ✅ TypeScript definitions complete for all APIs (Phase 1-3)
- ✅ Direct integration with `positron` namespace via API wrapper pattern

### Target State  
- Comprehensive, curated API wrapper exposing appropriate Positron functionality
- Interface-first development with incremental implementation
- Rich set of MCP tools for AI interaction with Positron features
- Type-safe, well-documented, and maintainable codebase

## Technical Architecture

### Interface-First Development Strategy

The implementation follows an **interface-first approach**:
1. **Define complete API interfaces** - Specify the full intended surface area upfront
2. **Implement incrementally** - Start with stubs, replace with real implementations progressively
3. **Maintain type safety** - Full TypeScript support and IntelliSense from day 1
4. **Clear roadmap** - Interface serves as implementation roadmap

### API Wrapper Design

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   MCP Client    │────│  MCP Server      │────│  API Wrapper    │
│   (AI Tool)     │    │  (HTTP/JSON-RPC) │    │  (Type-safe)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  Positron APIs  │
                                               │  (positron.*)   │
                                               └─────────────────┘
```

## Detailed Implementation Plan

### Phase 1: Core Runtime APIs ✅ COMPLETED

**Priority: HIGH** - Essential for AI code execution and session management
**Status: COMPLETED (2025-01-15)** - All core runtime APIs and primary MCP tools implemented

#### Runtime Management
```typescript
runtime: {
  // Session Management
  getForegroundSession(): Promise<RuntimeSession | undefined>;
  getActiveSessions(): Promise<RuntimeSession[]>;
  selectLanguageRuntime(runtimeId: string): Promise<void>;
  startLanguageRuntime(runtimeId: string, sessionName: string, notebookUri?: vscode.Uri): Promise<RuntimeSession>;
  restartSession(sessionId: string): Promise<void>;
  focusSession(sessionId: string): void;
  
  // Code Execution
  executeCode(languageId: string, code: string, options?: ExecuteCodeOptions): Promise<ExecutionResult>;
  
  // Variable Inspection
  getSessionVariables(sessionId: string, accessKeys?: string[][]): Promise<Variable[]>;
  querySessionTables(sessionId: string, accessKeys: string[][], queryTypes: string[]): Promise<QueryTableResult[]>;
  
  // Events
  onDidExecuteCode: vscode.Event<CodeExecutionEvent>;
  onDidChangeForegroundSession: vscode.Event<string | undefined>;
  onDidRegisterRuntime: vscode.Event<LanguageRuntimeMetadata>;
}
```

#### Expected Implementation
```typescript
class PositronApiWrapper implements PositronMcpApi {
  runtime = {
    async getForegroundSession() {
      return await positron.runtime.getForegroundSession();
    },
    
    async executeCode(languageId: string, code: string, options: ExecuteCodeOptions = {}) {
      const {
        focus = false,
        allowIncomplete = false,
        mode = positron.RuntimeCodeExecutionMode.Interactive,
        errorBehavior = positron.RuntimeErrorBehavior.Stop
      } = options;
      
      return await positron.runtime.executeCode(
        languageId, 
        code, 
        focus, 
        allowIncomplete, 
        mode, 
        errorBehavior
      );
    },
    
    async getSessionVariables(sessionId: string, accessKeys?: string[][]) {
      return await positron.runtime.getSessionVariables(sessionId, accessKeys);
    },
    
    // ... other implementations
  };
}
```

### Phase 2: Extended APIs ⚡ Implement Next

**Priority: MEDIUM** - Enhances AI interaction with editor and workspace

#### Window & Console APIs
```typescript
window: {
  // Console Interaction
  getConsoleForLanguage(languageId: string): Promise<Console | undefined>;
  getConsoleWidth(): Promise<number>;
  onDidChangeConsoleWidth: vscode.Event<number>;
  
  // Plot Management
  getPlotsRenderSettings(): Promise<PlotRenderSettings>;
  onDidChangePlotsRenderSettings: vscode.Event<PlotRenderSettings>;
  
  // UI Dialogs
  showSimpleModalDialogPrompt(title: string, message: string, okButton?: string, cancelButton?: string): Promise<boolean>;
  showSimpleModalDialogMessage(title: string, message: string, okButton?: string): Promise<void>;
  
  // Preview Panels
  createPreviewPanel(viewType: string, title: string, preserveFocus?: boolean, options?: PreviewOptions): PreviewPanel;
  previewUrl(url: vscode.Uri): PreviewPanel;
  previewHtml(path: string): PreviewPanel;
}
```

#### Editor & Document APIs
```typescript
editor: {
  // Active Editor
  getActiveDocument(): Promise<DocumentInfo | undefined>;
  getSelection(): Promise<SelectionInfo | undefined>;
  getVisibleRanges(): Promise<vscode.Range[]>;
  
  // Editor Context (from positron.methods.*)
  getLastActiveEditorContext(): Promise<EditorContext | null>;
  
  // Document Operations
  getDocumentText(uri: string, range?: vscode.Range): Promise<string>;
  insertText(uri: string, position: vscode.Position, text: string): Promise<void>;
  replaceText(uri: string, range: vscode.Range, text: string): Promise<void>;
}
```

#### Workspace APIs
```typescript
workspace: {
  // Workspace Info
  getWorkspaceFolders(): WorkspaceFolder[];
  getWorkspaceConfiguration(section?: string): Configuration;
  
  // File Operations
  readFile(uri: string): Promise<Uint8Array>;
  writeFile(uri: string, content: Uint8Array): Promise<void>;
  createFile(uri: string): Promise<void>;
  deleteFile(uri: string): Promise<void>;
  
  // Search & Navigation
  findFiles(include: string, exclude?: string, maxResults?: number): Promise<vscode.Uri[]>;
  openTextDocument(uri: string): Promise<vscode.TextDocument>;
}
```

### Phase 3: Advanced Features 🚀 Future Implementation

**Priority: LOW** - Specialized functionality for advanced AI interactions

#### Language Services
```typescript
languages: {
  // Statement Analysis
  getStatementRange(uri: string, position: vscode.Position): Promise<StatementRange | undefined>;
  getHelpTopic(uri: string, position: vscode.Position): Promise<string | undefined>;
  
  // Language Features
  getDocumentSymbols(uri: string): Promise<vscode.DocumentSymbol[]>;
  getDefinition(uri: string, position: vscode.Position): Promise<vscode.Location[]>;
  getReferences(uri: string, position: vscode.Position): Promise<vscode.Location[]>;
}
```

#### AI & Chat Integration
```typescript
ai: {
  // Plot Access
  getCurrentPlotUri(): Promise<string | undefined>;
  
  // Chat Context
  getPositronChatContext(request: any): Promise<ChatContext>;
  
  // Completions
  areCompletionsEnabled(file: vscode.Uri): Promise<boolean>;
  
  // Chat Export
  getChatExport(): Promise<object | undefined>;
}
```

#### Connections & Environment
```typescript
connections: {
  // Connection Management
  listConnections(): Promise<Connection[]>;
  createConnection(config: ConnectionConfig): Promise<void>;
  testConnection(config: ConnectionConfig): Promise<boolean>;
}

environment: {
  // Environment Variables
  getEnvironmentContributions(): Promise<Record<string, EnvironmentVariableAction[]>>;
  
  // Process Info
  getProcessInfo(): Promise<ProcessInfo>;
}
```

## Code Examples & Templates

### Core Interface Definition

Create `src/positronApi.ts`:

```typescript
import * as vscode from 'vscode';

/**
 * Comprehensive interface for Positron MCP API access.
 * This interface defines the complete surface area we intend to expose
 * to MCP clients for AI interaction with Positron.
 */
export interface PositronMcpApi {
  /**
   * Runtime management and code execution APIs
   */
  runtime: PositronRuntimeApi;
  
  /**
   * Window, console, and UI interaction APIs  
   */
  window: PositronWindowApi;
  
  /**
   * Editor and document manipulation APIs
   */
  editor: PositronEditorApi;
  
  /**
   * Workspace and file system APIs
   */
  workspace: PositronWorkspaceApi;
  
  /**
   * Language services and analysis APIs
   */
  languages?: PositronLanguagesApi; // Optional - Phase 3
  
  /**
   * AI and chat integration APIs
   */
  ai?: PositronAiApi; // Optional - Phase 3
  
  /**
   * Connection and environment APIs
   */
  connections?: PositronConnectionsApi; // Optional - Phase 3
  environment?: PositronEnvironmentApi; // Optional - Phase 3
}

/**
 * Runtime management and code execution
 */
export interface PositronRuntimeApi {
  /**
   * Get the currently active foreground runtime session
   * @returns Promise resolving to the active session or undefined if none
   */
  getForegroundSession(): Promise<RuntimeSession | undefined>;
  
  /**
   * Get all currently active runtime sessions
   * @returns Promise resolving to array of active sessions
   */
  getActiveSessions(): Promise<RuntimeSession[]>;
  
  /**
   * Execute code in a language runtime
   * @param languageId - Language identifier (e.g., 'python', 'r')
   * @param code - Code to execute
   * @param options - Execution options
   * @returns Promise resolving to execution result
   */
  executeCode(languageId: string, code: string, options?: ExecuteCodeOptions): Promise<ExecutionResult>;
  
  /**
   * Get variables from a runtime session
   * @param sessionId - Target session ID
   * @param accessKeys - Optional variable access keys to filter results
   * @returns Promise resolving to array of variable groups
   */
  getSessionVariables(sessionId: string, accessKeys?: string[][]): Promise<Variable[][]>;
  
  /**
   * Event fired when code is executed in any runtime
   */
  readonly onDidExecuteCode: vscode.Event<CodeExecutionEvent>;
  
  /**
   * Event fired when the foreground session changes
   */
  readonly onDidChangeForegroundSession: vscode.Event<string | undefined>;
}

/**
 * Code execution options
 */
export interface ExecuteCodeOptions {
  /** Whether to focus the runtime console after execution */
  focus?: boolean;
  
  /** Whether to allow incomplete code to be executed */
  allowIncomplete?: boolean;
  
  /** Code execution mode */
  mode?: 'interactive' | 'non-interactive' | 'transient' | 'silent';
  
  /** Error handling behavior */
  errorBehavior?: 'stop' | 'continue';
  
  /** Optional execution observer for streaming results */
  observer?: ExecutionObserver;
}

/**
 * Code execution result
 */
export interface ExecutionResult {
  /** Execution success status */
  success: boolean;
  
  /** Result data by MIME type */
  data?: Record<string, any>;
  
  /** Error information if execution failed */
  error?: {
    name: string;
    message: string;
    traceback?: string[];
  };
  
  /** Execution metadata */
  metadata?: {
    executionCount?: number;
    duration?: number;
    timestamp?: string;
  };
}

/**
 * Execution observer for streaming results
 */
export interface ExecutionObserver {
  /** Optional cancellation token */
  token?: vscode.CancellationToken;
  
  /** Called when execution starts */
  onStarted?(): void;
  
  /** Called when output is produced */
  onOutput?(message: string): void;
  
  /** Called when error output is produced */
  onError?(message: string): void;
  
  /** Called when execution completes successfully */
  onCompleted?(result: Record<string, any>): void;
  
  /** Called when execution fails */
  onFailed?(error: Error): void;
  
  /** Called when execution finishes (success or failure) */
  onFinished?(): void;
}

// ... Additional interface definitions for other APIs
```

### Implementation Template

Create `src/positronApiWrapper.ts`:

```typescript
import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronMcpApi, PositronRuntimeApi, ExecuteCodeOptions, ExecutionResult } from './positronApi';

/**
 * Implementation of the Positron MCP API wrapper.
 * This class provides controlled access to Positron functionality for MCP clients.
 */
export class PositronApiWrapper implements PositronMcpApi {
  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Runtime API implementation
   */
  readonly runtime: PositronRuntimeApi = {
    async getForegroundSession() {
      try {
        return await positron.runtime.getForegroundSession();
      } catch (error) {
        console.error('Failed to get foreground session:', error);
        return undefined;
      }
    },

    async getActiveSessions() {
      try {
        return await positron.runtime.getActiveSessions();
      } catch (error) {
        console.error('Failed to get active sessions:', error);
        return [];
      }
    },

    async executeCode(languageId: string, code: string, options: ExecuteCodeOptions = {}) {
      // Input validation
      if (!languageId?.trim()) {
        throw new Error('languageId is required');
      }
      if (!code?.trim()) {
        throw new Error('code is required');
      }

      try {
        const {
          focus = false,
          allowIncomplete = false,
          mode = 'interactive',
          errorBehavior = 'stop',
          observer
        } = options;

        // Convert mode string to enum
        const executionMode = this.parseExecutionMode(mode);
        const errorMode = errorBehavior === 'continue' 
          ? positron.RuntimeErrorBehavior.Continue 
          : positron.RuntimeErrorBehavior.Stop;

        // Execute with observer if provided
        if (observer) {
          return await positron.runtime.executeCode(
            languageId,
            code,
            focus,
            allowIncomplete,
            executionMode,
            errorMode,
            observer
          );
        }

        // Execute without observer
        const result = await positron.runtime.executeCode(
          languageId,
          code,
          focus,
          allowIncomplete,
          executionMode,
          errorMode
        );

        return {
          success: true,
          data: result,
          metadata: {
            timestamp: new Date().toISOString()
          }
        };
      } catch (error) {
        return {
          success: false,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
            traceback: error instanceof Error && 'stack' in error ? [error.stack!] : []
          }
        };
      }
    },

    async getSessionVariables(sessionId: string, accessKeys?: string[][]) {
      if (!sessionId?.trim()) {
        throw new Error('sessionId is required');
      }

      try {
        return await positron.runtime.getSessionVariables(sessionId, accessKeys);
      } catch (error) {
        console.error('Failed to get session variables:', error);
        return [];
      }
    },

    get onDidExecuteCode() {
      return positron.runtime.onDidExecuteCode;
    },

    get onDidChangeForegroundSession() {
      return positron.runtime.onDidChangeForegroundSession;
    }
  };

  /**
   * Window API implementation - mostly stubs initially
   */
  readonly window = {
    async getConsoleForLanguage(languageId: string) {
      if (!languageId?.trim()) {
        throw new Error('languageId is required');
      }
      
      try {
        return await positron.window.getConsoleForLanguage(languageId);
      } catch (error) {
        console.error('Failed to get console for language:', error);
        return undefined;
      }
    },

    async getConsoleWidth() {
      try {
        return await positron.window.getConsoleWidth();
      } catch (error) {
        console.error('Failed to get console width:', error);
        return 80; // Default fallback
      }
    },

    // TODO: Implement remaining window APIs
    async getPlotsRenderSettings() {
      try {
        return await positron.window.getPlotsRenderSettings();
      } catch (error) {
        console.error('Failed to get plots render settings:', error);
        throw error;
      }
    }
  };

  /**
   * Editor API implementation - new functionality
   */
  readonly editor = {
    async getActiveDocument() {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return undefined;
      }

      return {
        uri: editor.document.uri.toString(),
        languageId: editor.document.languageId,
        fileName: editor.document.fileName,
        isUntitled: editor.document.isUntitled,
        isDirty: editor.document.isDirty,
        lineCount: editor.document.lineCount,
        content: editor.document.getText()
      };
    },

    async getSelection() {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return undefined;
      }

      return {
        text: editor.document.getText(editor.selection),
        range: {
          start: {
            line: editor.selection.start.line,
            character: editor.selection.start.character
          },
          end: {
            line: editor.selection.end.line,
            character: editor.selection.end.character
          }
        }
      };
    },

    // TODO: Implement remaining editor APIs
  };

  /**
   * Workspace API implementation
   */
  readonly workspace = {
    getWorkspaceFolders() {
      return vscode.workspace.workspaceFolders?.map(folder => ({
        uri: folder.uri.toString(),
        name: folder.name,
        index: folder.index
      })) ?? [];
    },

    getWorkspaceConfiguration(section?: string) {
      const config = vscode.workspace.getConfiguration(section);
      return {
        get: <T>(key: string, defaultValue?: T) => config.get(key, defaultValue),
        has: (key: string) => config.has(key),
        inspect: <T>(key: string) => config.inspect<T>(key)
      };
    }

    // TODO: Implement file operation APIs
  };

  /**
   * Utility method to convert execution mode string to enum
   */
  private parseExecutionMode(mode: string) {
    switch (mode) {
      case 'interactive':
        return positron.RuntimeCodeExecutionMode.Interactive;
      case 'non-interactive':
        return positron.RuntimeCodeExecutionMode.NonInteractive;
      case 'transient':
        return positron.RuntimeCodeExecutionMode.Transient;
      case 'silent':
        return positron.RuntimeCodeExecutionMode.Silent;
      default:
        return positron.RuntimeCodeExecutionMode.Interactive;
    }
  }
}
```

## MCP Tool Specifications

### New Tools to Implement

#### 1. `execute-code` Tool

**Description**: Execute code in the active runtime with streaming results

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "languageId": {
      "type": "string",
      "description": "Language identifier (python, r, etc.)",
      "enum": ["python", "r", "javascript", "typescript"]
    },
    "code": {
      "type": "string",
      "description": "Code to execute"
    },
    "options": {
      "type": "object",
      "properties": {
        "focus": {
          "type": "boolean",
          "description": "Focus console after execution",
          "default": false
        },
        "mode": {
          "type": "string",
          "enum": ["interactive", "non-interactive", "transient", "silent"],
          "default": "interactive"
        },
        "allowIncomplete": {
          "type": "boolean",
          "description": "Allow incomplete code execution",
          "default": false
        }
      }
    }
  },
  "required": ["languageId", "code"]
}
```

**Response Format**:
```json
{
  "success": true,
  "data": {
    "text/plain": "Result output",
    "image/png": "base64-encoded-image-data"
  },
  "metadata": {
    "executionCount": 5,
    "duration": 1250,
    "timestamp": "2024-11-05T10:30:00.000Z"
  }
}
```

**Implementation in MCP Server**:
```typescript
case 'execute-code':
  try {
    const { languageId, code, options = {} } = request.params.arguments;
    
    const result = await this.api.runtime.executeCode(languageId, code, options);
    
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify(result)
        }]
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: `Code execution failed: ${error.message}`
      }
    };
  }
```

#### 2. `get-active-document` Tool

**Description**: Get information about the currently active document

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "includeContent": {
      "type": "boolean",
      "description": "Whether to include full document content",
      "default": false
    },
    "includeSelection": {
      "type": "boolean", 
      "description": "Whether to include current selection",
      "default": true
    }
  }
}
```

**Response Format**:
```json
{
  "document": {
    "uri": "file:///path/to/file.py",
    "languageId": "python",
    "fileName": "analysis.py",
    "lineCount": 150,
    "isDirty": false,
    "content": "# Full content if requested"
  },
  "selection": {
    "text": "selected text",
    "range": {
      "start": {"line": 10, "character": 0},
      "end": {"line": 12, "character": 15}
    }
  }
}
```

#### 3. `get-workspace-info` Tool

**Description**: Get comprehensive workspace information

**Input Schema**:
```json
{
  "type": "object", 
  "properties": {
    "includeConfig": {
      "type": "boolean",
      "description": "Include workspace configuration",
      "default": true
    },
    "configSection": {
      "type": "string",
      "description": "Specific config section to retrieve"
    }
  }
}
```

**Response Format**:
```json
{
  "folders": [
    {
      "uri": "file:///path/to/workspace",
      "name": "my-project",
      "index": 0
    }
  ],
  "configuration": {
    "python.defaultInterpreterPath": "/usr/bin/python3",
    "positron.mcp.enable": true
  },
  "activeRuntimes": [
    {
      "languageId": "python",
      "sessionId": "session-123",
      "sessionName": "Python Console"
    }
  ]
}
```

### Tool Registration Pattern

Update `src/mcpServer.ts` to register new tools:

```typescript
case 'tools/list':
  return {
    jsonrpc: '2.0',
    id: request.id,
    result: {
      tools: [
        // Existing tools
        {
          name: 'get-time',
          description: 'Get current time in ISO format',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false
          }
        },
        
        // New Phase 1 tools
        {
          name: 'execute-code',
          description: 'Execute code in the active runtime session',
          inputSchema: {
            type: 'object',
            properties: {
              languageId: {
                type: 'string',
                description: 'Language identifier (python, r, etc.)',
                enum: ['python', 'r', 'javascript', 'typescript']
              },
              code: {
                type: 'string',
                description: 'Code to execute'
              },
              options: {
                type: 'object',
                properties: {
                  focus: { type: 'boolean', default: false },
                  mode: { 
                    type: 'string',
                    enum: ['interactive', 'non-interactive', 'transient', 'silent'],
                    default: 'interactive'
                  },
                  allowIncomplete: { type: 'boolean', default: false }
                }
              }
            },
            required: ['languageId', 'code']
          }
        },
        
        {
          name: 'get-active-document',
          description: 'Get information about the currently active document',
          inputSchema: {
            type: 'object',
            properties: {
              includeContent: { type: 'boolean', default: false },
              includeSelection: { type: 'boolean', default: true }
            }
          }
        },
        
        {
          name: 'get-workspace-info', 
          description: 'Get comprehensive workspace information',
          inputSchema: {
            type: 'object',
            properties: {
              includeConfig: { type: 'boolean', default: true },
              configSection: { type: 'string' }
            }
          }
        }
      ]
    }
  };
```

## Development Workflow

### Step-by-Step Implementation Guide

#### Step 1: Create API Interface Files
1. **Create `src/positronApi.ts`** - Define complete interfaces with JSDoc
2. **Create `src/positronApiWrapper.ts`** - Implement wrapper class
3. **Update TypeScript configuration** - Ensure proper imports and exports

#### Step 2: Update Extension Entry Point  
1. **Modify `src/extension.ts`**:
   - Import new API wrapper
   - Return API wrapper from `activate()` function
   - Inject API wrapper into MCP server

```typescript
import { PositronApiWrapper } from './positronApiWrapper';

export async function activate(context: vscode.ExtensionContext): Promise<PositronApiWrapper> {
  // ... existing setup
  
  const apiWrapper = new PositronApiWrapper(context);
  
  if (mcpServer) {
    mcpServer.setApi(apiWrapper);
  }
  
  return apiWrapper; // Export for extension host
}
```

#### Step 3: Update MCP Server
1. **Modify `src/mcpServer.ts`**:
   - Add API injection method
   - Replace direct positron imports with API calls
   - Add new tool implementations

```typescript
export class McpServer {
  private api?: PositronMcpApi;
  
  setApi(api: PositronMcpApi) {
    this.api = api;
  }
  
  private async getForegroundSessionInfo() {
    if (!this.api) {
      throw new Error('API not initialized');
    }
    
    const session = await this.api.runtime.getForegroundSession();
    // ... rest of implementation
  }
}
```

#### Step 4: Implement Phase 1 Tools
1. **execute-code tool** - Code execution with streaming
2. **get-active-document tool** - Editor document information
3. **get-workspace-info tool** - Workspace metadata

#### Step 5: Testing & Validation
1. **Test each tool individually** - Verify request/response format
2. **Integration testing** - Test with real AI clients
3. **Error handling** - Verify graceful failure modes
4. **Performance testing** - Ensure reasonable response times

#### Step 6: Documentation & Examples
1. **Update README.md** - Document new capabilities
2. **Create usage examples** - Show AI interaction patterns
3. **API documentation** - Complete JSDoc for all methods

### Implementation Priorities with Security Integration

**Phase 0: Security Foundation** ✅ COMPLETED (2025-01-15)
- [x] Create security-aware API interface definitions
- [x] Implement MinimalSecurityMiddleware class
- [x] Remove wildcard CORS policy (replaced with localhost-only)
- [x] Add comprehensive audit logging
- [x] Create security configuration system
- [x] Add user consent for code execution
- [x] Implement rate limiting
- [x] Add security management commands

**Phase 1 (Week 2-3): Core Runtime APIs** ✅ COMPLETED
- [x] Implement PositronApiWrapper class
- [x] Update extension.ts to export API
- [x] Add execute-code tool
- [x] Add get-active-document tool
- [x] Add get-workspace-info tool
- [x] Implement all Runtime API methods (getForegroundSession, executeCode, getSessionVariables, etc.)
- [x] Implement Editor API methods (getActiveDocument, getSelection, getDocumentText, insertText, replaceText)
- [x] Implement Workspace API methods (getWorkspaceFolders, readFile, writeFile, findFiles, etc.)

**Phase 2 (Week 3-4): Extended APIs**
- [ ] Implement window APIs (console, plots, dialogs)
- [ ] Implement extended editor APIs (text manipulation)
- [ ] Implement workspace file operations
- [ ] Add corresponding MCP tools
- [ ] Comprehensive testing

**Phase 3 (Week 5+): Advanced Features**
- [ ] Language services integration
- [ ] AI and chat APIs
- [ ] Connection management
- [ ] Environment APIs  
- [ ] Performance optimization
- [ ] Final documentation

## File Structure & Organization

```
extensions/positron-mcp/
├── src/
│   ├── extension.ts                 # Entry point ✅ 
│   ├── mcpServer.ts                # MCP server ✅
│   ├── positronApi.ts              # API interface definitions ✅
│   ├── positronApiWrapper.ts       # API implementation ✅
│   └── logger.ts                   # Logging utilities ✅
├── tests/                          # Test files (TODO)
│   ├── api-wrapper.test.ts         # API wrapper tests
│   ├── mcp-tools.test.ts          # MCP tool tests
│   └── integration.test.ts         # Integration tests
├── docs/                           # Documentation (TODO)
│   ├── api-reference.md            # Complete API reference
│   ├── tool-specifications.md      # MCP tool specs
│   └── examples/                   # Usage examples
├── package.json                    # Updated dependencies ✅
├── tsconfig.json                   # Updated TypeScript config ✅
├── README.md                       # Extension documentation ✅
└── positron-mcp-dev-plan.md       # This document ✅
```

### TypeScript Configuration Updates

Update `tsconfig.json` to include new files:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "out",
    "sourceMap": true,
    "skipLibCheck": true,
    "types": ["node"],
    "typeRoots": ["./node_modules/@types"],
    "strict": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true
  },
  "include": [
    "src/**/*",
    "tests/**/*",
    "../../src/vscode-dts/vscode.d.ts",
    "../../src/positron-dts/positron.d.ts"
  ],
  "exclude": ["node_modules", ".vscode-test", "out"]
}
```

### Package.json Dependencies

Add development dependencies to `package.json`:

```json
{
  "devDependencies": {
    "@types/mocha": "^10.0.0",
    "@types/chai": "^4.3.0", 
    "mocha": "^10.0.0",
    "chai": "^4.3.0",
    "sinon": "^15.0.0",
    "@types/sinon": "^10.0.0"
  }
}
```

## Testing & Validation

### Unit Testing Strategy

#### API Wrapper Tests (`tests/api-wrapper.test.ts`)

```typescript
import { expect } from 'chai';
import { describe, it, beforeEach, afterEach } from 'mocha';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { PositronApiWrapper } from '../src/positronApiWrapper';

describe('PositronApiWrapper', () => {
  let wrapper: PositronApiWrapper;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    context = {} as vscode.ExtensionContext;
    wrapper = new PositronApiWrapper(context);
  });

  describe('runtime API', () => {
    it('should execute code successfully', async () => {
      const result = await wrapper.runtime.executeCode('python', 'print("hello")');
      
      expect(result).to.have.property('success', true);
      expect(result).to.have.property('data');
    });

    it('should handle execution errors gracefully', async () => {
      const result = await wrapper.runtime.executeCode('python', 'invalid syntax');
      
      expect(result).to.have.property('success', false);
      expect(result).to.have.property('error');
    });
  });

  describe('editor API', () => {
    it('should return undefined when no document is active', async () => {
      sinon.stub(vscode.window, 'activeTextEditor').value(undefined);
      
      const result = await wrapper.editor.getActiveDocument();
      
      expect(result).to.be.undefined;
    });
  });
});
```

#### MCP Tool Tests (`tests/mcp-tools.test.ts`)

```typescript
import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { McpServer } from '../src/mcpServer';
import { PositronApiWrapper } from '../src/positronApiWrapper';

describe('MCP Tools', () => {
  let server: McpServer;
  let api: PositronApiWrapper;

  beforeEach(() => {
    server = new McpServer();
    api = new PositronApiWrapper({} as any);
    server.setApi(api);
  });

  describe('execute-code tool', () => {
    it('should execute Python code and return result', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'execute-code',
          arguments: {
            languageId: 'python',
            code: 'print("Hello, World!")'
          }
        }
      };

      const response = await server.handleMcpRequest(request as any, {} as any);
      
      expect(response).to.have.property('result');
      expect(response.result).to.have.property('content');
    });
  });
});
```

### Integration Testing

#### Manual Testing Checklist

**Phase 1 Testing:** ✅ COMPLETED
- [x] Extension activates without errors
- [x] MCP server starts on correct port (43123)
- [x] API wrapper is properly injected
- [x] execute-code tool works with Python
- [x] execute-code tool works with R  
- [x] get-active-document returns proper format
- [x] get-workspace-info includes all expected fields
- [x] Error handling works for invalid inputs

**Phase 2 Testing:**
- [ ] Console APIs work correctly
- [ ] Plot APIs return proper settings
- [ ] Editor text manipulation works
- [ ] Workspace file operations succeed
- [ ] All new MCP tools respond correctly

**AI Client Testing:**
- [ ] Claude Desktop can connect to MCP server
- [ ] All tools are discoverable via tools/list
- [ ] Tool schemas validate correctly
- [ ] Response formats are consumable by AI
- [ ] Error messages are helpful for debugging

### Performance Benchmarks

Target performance metrics:
- **Tool response time**: < 100ms for simple operations
- **Code execution**: < 5s for typical scripts
- **Memory usage**: < 50MB additional overhead
- **Startup time**: < 2s additional activation time

## Future Considerations

### Extension Points for New APIs

The interface-first approach makes it easy to add new APIs:

1. **Add to interface definition** - Update `positronApi.ts`
2. **Implement in wrapper** - Add to `positronApiWrapper.ts`
3. **Create MCP tools** - Add tool definitions to `mcpServer.ts`
4. **Update documentation** - Add to API reference

### Versioning Strategy

**API Versioning**:
- Use semantic versioning for API changes
- Maintain backward compatibility within major versions  
- Deprecation warnings for removed functionality
- Clear migration guides for breaking changes

**MCP Protocol Versioning**:
- Support multiple MCP protocol versions simultaneously
- Graceful degradation for older clients
- Feature detection for capability negotiation

### Performance Optimization

**Future optimizations to consider**:
- **Caching**: Cache expensive API calls (session info, workspace config)
- **Batching**: Batch multiple API calls into single operations
- **Streaming**: Stream large results for better UX
- **Connection pooling**: Reuse runtime connections
- **Lazy loading**: Load APIs only when requested

### Security Considerations

**Current security model**:
- Localhost-only access (bound to 127.0.0.1)
- No authentication required (local process)
- Input validation on all parameters
- No direct file system access without user consent

**Future security enhancements**:
- Optional API key authentication
- Permission-based API access
- User confirmation for sensitive operations
- Audit logging for compliance

## Conclusion

This development plan provides a complete roadmap for exposing Positron's API surface area to MCP clients in a clean, maintainable, and extensible way. The interface-first approach ensures type safety and clear development priorities, while the phased implementation allows for incremental delivery and testing.

Key benefits of this approach:
- **Type-safe development** with full IntelliSense support
- **Clear separation of concerns** between MCP protocol and Positron APIs  
- **Extensible architecture** that can grow with future requirements
- **Comprehensive testing strategy** for reliability and maintainability
- **Developer-friendly** with complete documentation and examples

The plan prioritizes the most valuable APIs first (runtime and code execution) while providing a clear path for extending to more advanced features like AI integration and connection management.