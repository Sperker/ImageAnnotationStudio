@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem ===========================================================================
rem IMAGE ANNOTATION STUDIO - WINDOWS BUILD AND COMPLETE TEST SUITE
rem ===========================================================================
rem Table of contents:
rem 01. Resolve working directory and locate required tools
rem 02. Optional one-time Python/Playwright/browser setup
rem 03. Build the single versioned HTML and execute Node unit tests
rem 04. Run Smoke and E2E regressions in Chromium, Firefox and WebKit
rem 05. Print final failure count and pause before closing
rem ===========================================================================
rem Image Annotation Studio - Build and complete browser test suite.
rem Place this file in the project root (next to package.json).
rem Usage:
rem   Double-click run-build-and-tests.bat
rem   run-build-and-tests.bat --setup   (install Python test requirements and browsers)

rem ---------------------------------------------------------------------------
rem 01. Locate the repository: %~dp0 expands to this batch file's folder.
rem ---------------------------------------------------------------------------
pushd "%~dp0"
if errorlevel 1 (
    echo [ERROR] Cannot open the project folder.
    pause
    exit /b 1
)

set "FAILURES=0"
set "PYTHON_CMD="
set "STUDIO_BROWSER="

echo.
echo ===========================================================
echo   IMAGE ANNOTATION STUDIO - BUILD AND TESTS

echo ===========================================================
echo Project: %CD%
echo.

if not exist "package.json" (
    echo [ERROR] package.json was not found.
    echo Copy this batch file into the root of the project.
    set /a FAILURES+=1
    goto :summary
)

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found. Install Node.js 20 or newer.
    set /a FAILURES+=1
    goto :summary
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Install Node.js 20 or newer.
    set /a FAILURES+=1
    goto :summary
)

python --version >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"
if not defined PYTHON_CMD (
    py -3 --version >nul 2>nul
    if not errorlevel 1 set "PYTHON_CMD=py -3"
)
if not defined PYTHON_CMD (
    echo [ERROR] Python 3 was not found.
    echo Install Python 3 and ensure python or py is available.
    set /a FAILURES+=1
    goto :summary
)

rem ---------------------------------------------------------------------------
rem 02. Install development-only dependencies only if --setup is provided.
rem ---------------------------------------------------------------------------
if /i "%~1"=="--setup" (
    echo [SETUP] Installing Python test requirements and browser binaries.
    echo [SETUP] This requires an Internet connection and free disk space.
    call :setup_tests
    if errorlevel 1 (
        echo [ERROR] Test dependency setup failed.
        set /a FAILURES+=1
        goto :summary
    )
)

echo.
rem ---------------------------------------------------------------------------
rem 03. The build is prerequisite to every test; unit failures are counted.
rem ---------------------------------------------------------------------------
echo [BUILD] npm run build
call npm run build
if errorlevel 1 (
    echo [FAIL] Build failed. Browser tests cannot run reliably.
    set /a FAILURES+=1
    goto :summary
)
echo [PASS] Build completed.

echo.
echo [UNIT] npm test
call npm test
if errorlevel 1 (
    echo [FAIL] Unit tests failed.
    set /a FAILURES+=1
) else (
    echo [PASS] Unit tests passed.
)

%PYTHON_CMD% -c "import playwright.sync_api" >nul 2>nul
if errorlevel 1 (
    echo.
    echo [ERROR] Python Playwright is missing.
    echo To install development test tools and browser engines, run:
    echo     run-build-and-tests.bat --setup
    echo Build and unit tests have completed; browser tests were NOT run.
    set /a FAILURES+=1
    goto :summary
)

rem ---------------------------------------------------------------------------
rem 04. Run each available browser; count errors without hiding later failures.
rem ---------------------------------------------------------------------------
call :test_browser chromium
call :test_browser firefox
call :test_browser webkit

goto :summary

:setup_tests
%PYTHON_CMD% -m pip install -r "requirements-dev.txt"
if errorlevel 1 exit /b 1
%PYTHON_CMD% -m playwright install chromium firefox webkit
if errorlevel 1 exit /b 1
exit /b 0

:test_browser
set "STUDIO_BROWSER=%~1"
echo.
echo -----------------------------------------------------------
echo [SMOKE] %STUDIO_BROWSER%
echo -----------------------------------------------------------
%PYTHON_CMD% -m unittest discover -s "tests\smoke" -p "test_*.py" -v
if errorlevel 1 (
    echo [FAIL] Smoke tests: %STUDIO_BROWSER%
    set /a FAILURES+=1
) else (
    echo [PASS] Smoke tests: %STUDIO_BROWSER%
)
echo.
echo [REGRESSION] %STUDIO_BROWSER%
%PYTHON_CMD% -m unittest discover -s "tests\e2e" -p "test_*.py" -v
if errorlevel 1 (
    echo [FAIL] Regression tests: %STUDIO_BROWSER%
    set /a FAILURES+=1
) else (
    echo [PASS] Regression tests: %STUDIO_BROWSER%
)
exit /b 0

rem ---------------------------------------------------------------------------
rem 05. Report all failed stages and keep the Windows console open for review.
rem ---------------------------------------------------------------------------
:summary
set "STUDIO_BROWSER="
echo.
echo ===========================================================
if "%FAILURES%"=="0" (
    echo   RESULT: ALL BUILD AND TEST STAGES PASSED
    echo   Output filename and location are shown in the [BUILD] line above.
    set "FINAL_EXIT=0"
) else (
    echo   RESULT: %FAILURES% STAGE^(S^) FAILED OR COULD NOT RUN
    echo   Check the messages above for details.
    echo   If browser engines are missing, use --setup.
    set "FINAL_EXIT=1"
)
echo ===========================================================
echo.
popd
echo Press any key to close this window.
pause >nul
endlocal & exit /b %FINAL_EXIT%
