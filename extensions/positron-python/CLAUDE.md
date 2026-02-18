# Positron Python Extension

Python language support for the Positron IDE. Fork of Microsoft's Python extension with data science enhancements.

## Project Structure

- `src/` - TypeScript extension code
- `python_files/posit/positron/` - Python kernel extending ipykernel
- `python_files/posit/positron/tests/` - Python kernel unit tests
- `python_files/posit/positron/_vendor/` - Vendored Python kernel dependencies
- `python_files/lib/` - Dependencies bundled with the extension
- `build/` - Build configurations

## Testing

- **Python**: Run pytest from `extensions/positron-python/python_files/posit`
- **TypeScript**: `npm run test-extension -- -l positron-python --grep "pattern"`
- Never use `if __name__ == "__main__"` in test files
- Use parametrized tests (`@pytest.mark.parametrize`) for comprehensive coverage

## Code Quality

- **Check**: `./scripts/check-python-quality.sh`
- **Fix**: `./scripts/fix-python-format.sh`

## Optional Dependencies

Use graceful degradation for optional dependencies:

```python
try:
    import optional_library
    HAS_OPTIONAL = True
except ImportError:
    HAS_OPTIONAL = False

def enhanced_function(data):
    if HAS_OPTIONAL:
        return optional_library.process(data)
    return fallback_implementation(data)
```
