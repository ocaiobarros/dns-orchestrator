"""
DNS Control — Import Sanity Test
Ensures all backend modules compile without SyntaxError/IndentationError.
This prevents broken deploys caused by malformed f-strings or stray triple-quotes.
"""

import importlib
import pkgutil
import sys
import os


def test_all_modules_importable():
    """Every .py file under backend/app/ must compile without errors."""
    base = os.path.join(os.path.dirname(__file__), "..", "app")
    base = os.path.abspath(base)
    errors = []

    for root, _dirs, files in os.walk(base):
        for fname in files:
            if not fname.endswith(".py"):
                continue
            path = os.path.join(root, fname)
            try:
                with open(path) as f:
                    compile(f.read(), path, "exec")
            except SyntaxError as e:
                errors.append(f"{path}: {e}")

    assert errors == [], f"Syntax errors found:\n" + "\n".join(errors)
