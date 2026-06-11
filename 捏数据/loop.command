#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
./loop.sh

echo "Press Enter to close."
read -r
