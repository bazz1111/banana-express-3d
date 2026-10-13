#!/bin/sh
set -eu
game_root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
cd "$game_root"
if command -v node >/dev/null 2>&1; then
  game_node=$(command -v node)
else
  game_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [ ! -x "$game_node" ]; then
  echo "请先安装 Node.js 24 或更新版本。"
  exit 1
fi
if [ ! -f node_modules/vite/bin/vite.js ]; then
  echo "请先在项目目录运行 pnpm install。"
  exit 1
fi
exec "$game_node" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173
