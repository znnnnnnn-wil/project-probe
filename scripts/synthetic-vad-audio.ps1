param([Parameter(Mandatory = $true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$fullPath = [System.IO.Path]::GetFullPath($OutputPath)
$parent = [System.IO.Path]::GetDirectoryName($fullPath)
[System.IO.Directory]::CreateDirectory($parent) | Out-Null
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $speaker.Rate = -1
    $speaker.SetOutputToWaveFile($fullPath)
    $speaker.Speak('This is synthetic test audio. I implemented the reservation interface and concurrency tests. The database constraint prevents duplicate reservations.')
} finally {
    $speaker.Dispose()
}
