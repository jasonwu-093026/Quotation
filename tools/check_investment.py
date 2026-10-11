#!/usr/bin/env python3
"""議題 #6：以虛構資料檢查私人投資工具的真實頁面，逐列 PASS/FAIL。

執行：python3 tools/check_investment.py
需要 Node.js 22 與 Playwright Chromium / WebKit；使用專屬 PORT（預設 9006）。
只啟動自己的私人伺服器；所有資料位於隔離的瀏覽器測試環境，不影響既有紀錄。
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parent.parent
node = os.environ.get('INVEST_TEST_NODE', 'node')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium-only', action='store_true', help='僅檢查 Chromium；WebKit／實體 Safari 仍待驗證')
args = parser.parse_args()
flags = ['--chromium-only'] if args.chromium_only else []
raise SystemExit(subprocess.call([node, str(root / 'tools/check_investment.mjs'), *flags], cwd=root))
