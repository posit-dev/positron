
## Data Explorer - Variable Change Detection

### Status: Not Implemented

**Description**: When a DataFrame being viewed in Data Explorer is modified (rows/columns added/removed, data changed), the Data Explorer should detect the change and update the view.

**Requirements**:
- Track which variables are being viewed
- Detect changes to those variables in post-execute hook
- Send schema change events if columns changed
- Send data update events if rows changed
- Preserve user's sort/filter state during updates

**Reference**: 
- Python: test_variable_updates, test_schema_change_scenario1-8
- Complex feature with 8+ test scenarios

**Priority**: Medium (nice-to-have, not core for initial release)

**Current**: Data Explorer works for static views. User must manually refresh if data changes.

