from dataclasses import asdict
from typing import List

from positron.utils import DataclassProtocol


def assert_dataclass_equal(
    actual: DataclassProtocol, expected: DataclassProtocol, exclude: List[str]
) -> None:
    actual_dict = asdict(actual)
    expected_dict = asdict(expected)

    [actual_dict.pop(key) for key in exclude]
    [expected_dict.pop(key) for key in exclude]

    assert actual_dict == expected_dict
