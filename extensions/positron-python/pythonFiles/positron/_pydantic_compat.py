try:
    from pydantic.v1 import BaseModel, Field, validator, NonNegativeInt, ValidationError  # noqa
except ImportError:
    from pydantic import BaseModel, Field, validator, NonNegativeInt, ValidationError  # noqa
