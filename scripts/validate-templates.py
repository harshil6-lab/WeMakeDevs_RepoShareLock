#!/usr/bin/env python3
"""Validates the CloudFormation templates in this repository.

Runs anywhere Python and PyYAML are available and needs no AWS credentials. It
parses each template with a permissive loader that understands CloudFormation
short-form intrinsics (!Ref, !Sub, !GetAtt, !If, ...) and then checks the basic
shape CloudFormation requires: a Resources section with at least one logical id.

Usage: python scripts/validate-templates.py [path ...]
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - guidance for local runs
    print("PyYAML is required: python -m pip install PyYAML", file=sys.stderr)
    raise SystemExit(2)

DEFAULT_PATHS = [
    Path("infrastructure/cloudformation/template.yaml"),
    Path("infrastructure/cloudformation/app.yaml"),
]


class CloudFormationLoader(yaml.SafeLoader):
    """SafeLoader that accepts any CloudFormation short-form intrinsic."""


def _ignore_unknown_tag(loader: CloudFormationLoader, tag_suffix: str, node: yaml.Node) -> object:
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node, deep=True)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    return loader.construct_scalar(node)


CloudFormationLoader.add_multi_constructor("!", _ignore_unknown_tag)


def validate(path: Path) -> list[str]:
    errors: list[str] = []
    if not path.exists():
        return [f"{path}: file not found"]
    try:
        document = yaml.load(path.read_text(encoding="utf-8"), Loader=CloudFormationLoader)
    except yaml.YAMLError as error:
        return [f"{path}: invalid YAML: {error}"]
    if not isinstance(document, dict):
        return [f"{path}: template must be a mapping"]
    resources = document.get("Resources")
    if not isinstance(resources, dict) or not resources:
        errors.append(f"{path}: missing or empty Resources section")
    else:
        for logical_id in resources:
            if not isinstance(logical_id, str) or not logical_id[:1].isalpha():
                errors.append(f"{path}: invalid logical id {logical_id!r}")
        print(f"OK {path}: {len(resources)} resources")
    outputs = document.get("Outputs")
    if outputs is not None and not isinstance(outputs, dict):
        errors.append(f"{path}: Outputs must be a mapping")
    return errors


def main(argv: list[str]) -> int:
    paths = [Path(argument) for argument in argv[1:]] or DEFAULT_PATHS
    failures: list[str] = []
    for path in paths:
        failures.extend(validate(path))
    if failures:
        for failure in failures:
            print(f"FAIL {failure}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))