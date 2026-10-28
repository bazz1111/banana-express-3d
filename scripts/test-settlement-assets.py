"""Manifest/source-aware environment acceptance; --candidate checks the isolated build."""
from pathlib import Path
import importlib.util

path = Path(__file__).resolve().parent/'banana-tripo/environment-checks.py'
spec = importlib.util.spec_from_file_location('tripo_environment_checks', path)
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)
checks.run('settlement')
