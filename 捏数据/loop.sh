#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="cases"
COUNT=15

compiler=""
if command -v /opt/homebrew/bin/g++-14 >/dev/null 2>&1; then
  compiler="/opt/homebrew/bin/g++-14"
elif command -v g++ >/dev/null 2>&1; then
  compiler="g++"
else
  echo "Error: g++ not found. Install Xcode command line tools or Homebrew gcc." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

"$compiler" -std=gnu++17 -O2 -o makedata makedata.cpp
"$compiler" -std=gnu++17 -O2 -o std std.cpp

for ((i=1; i<=COUNT; i++)); do
  ./makedata "$i" > "$OUT_DIR/$i.in"
  ./std < "$OUT_DIR/$i.in" > "$OUT_DIR/$i.out"
done

echo "Generated $COUNT test cases in \"$OUT_DIR\"."
