# 点调用：. ./scripts/load-env.ps1
$projectRoot = Split-Path $PSScriptRoot -Parent
$configPath = Join-Path $projectRoot '.env'
if (Test-Path -LiteralPath $configPath) {
    foreach ($line in [IO.File]::ReadAllLines($configPath)) {
        if ($line -match '^\s*([A-Z][A-Z0-9_]*)=(.*)$') {
            $configName = $matches[1]
            $configValue = $matches[2].Trim()
            if ($configName -notin @('HOME','CODEX_HOME','PATH','PSMODULEPATH')) {
                [Environment]::SetEnvironmentVariable($configName, $configValue, 'Process')
            }
        }
    }
}
