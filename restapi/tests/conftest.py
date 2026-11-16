"""
Pytest configuration for REST API tests.
Adds the restapi directory to sys.path for imports.
"""
import sys
import os

# Add the parent directory to path so we can import from main
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))