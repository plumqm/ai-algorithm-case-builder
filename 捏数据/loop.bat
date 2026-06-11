@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "OUT_DIR=cases"
set "COUNT=15"

if not exist "%OUT_DIR%" md "%OUT_DIR%"

for /l %%I in (1,1,%COUNT%) do (
	makedata %%I > "%OUT_DIR%\%%I.in"
	std < "%OUT_DIR%\%%I.in" > "%OUT_DIR%\%%I.out"
)

echo Generated %COUNT% test cases in "%OUT_DIR%".
pause