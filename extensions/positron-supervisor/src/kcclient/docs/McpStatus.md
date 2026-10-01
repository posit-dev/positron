# McpStatus


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**active** | **boolean** | Whether the MCP listener is running | [default to undefined]
**port** | **number** | The port the MCP listener is bound to, or 0 when inactive | [default to undefined]
**request_count** | **number** | The number of MCP tool calls served since the listener started | [default to undefined]
**workspaces** | [**Array&lt;McpWorkspaceStatus&gt;**](McpWorkspaceStatus.md) |  | [default to undefined]

## Example

```typescript
import { McpStatus } from './api';

const instance: McpStatus = {
    active,
    port,
    request_count,
    workspaces,
};
```

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)
