# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
# Verify the actual extract-and-run ZIP, not the runner's installed build tree.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$install = Join-Path $root 'build.install'
$artifacts = Join-Path $root 'build.artifacts'
$zip = Join-Path $artifacts "MuseScore-Studio-Portable-$env:BUILD_NUMBER-x64.zip"
$probe = Join-Path $env:RUNNER_TEMP 'MuseScore Portable clean first launch'
$score = Join-Path $root 'src\engraving\tests\automation\data\tempo_relative.mscx'

if (-not (Test-Path (Join-Path $install 'MuseScorePortable.exe'))) {
    throw 'The PortableApps launcher was not generated.'
}
if (-not (Get-ChildItem $artifacts -Filter '*.paf.exe' -File)) {
    throw 'The PortableApps package was not created.'
}
# Zip the *contents*, not the enclosing build.install directory. Users may
# unzip anywhere and launch MuseScorePortable.exe without installing anything.
Push-Location $install
try {
    & 7z a -tzip $zip '.\*' -mx=1
    if ($LASTEXITCODE -ne 0) { throw "7z failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}
if (Test-Path $probe) { Remove-Item $probe -Recurse -Force }
Expand-Archive -LiteralPath $zip -DestinationPath $probe
$launcher = Join-Path $probe 'MuseScorePortable.exe'
$exe = Join-Path $probe 'App\MuseScore\bin\MuseScoreStudio5.exe'
$font = Join-Path $probe 'App\MuseScore\sound\MS Basic.sf3'
$license = Join-Path $probe 'App\MuseScore\sound\MS Basic_License.md'
$qt = Join-Path $probe 'App\MuseScore\bin\Qt6Core.dll'
$choir = Join-Path $probe 'App\MuseScore\choir-studio'
foreach ($required in @($launcher, $exe, $font, $license, $qt,
    (Join-Path $choir 'index.html'), (Join-Path $choir 'choir.js'),
    (Join-Path $choir 'studio.js'), (Join-Path $choir 'project.js'), (Join-Path $choir 'README.md'),
    (Join-Path $choir 'examples\four-independent-parts.mid'),
    (Join-Path $choir 'examples\four-part-synthetic-mix.wav'),
    (Join-Path $choir 'examples\four-part-real-vowel-mix.wav'),
    (Join-Path $choir 'examples\four-part-long-vowel-mix.wav'),
    (Join-Path $choir 'examples\after-long-soprano-A4.wav'),
    (Join-Path $choir 'examples\after-tagged-real-tenor.wav'),
    (Join-Path $choir 'examples\tagged-real-tenor-metrics.json'),
    (Join-Path $choir 'examples\tagged-real-tenor.choir.json'),
    (Join-Path $choir 'examples\after-tagged-A4-to-B4.wav'),
    (Join-Path $choir 'examples\after-tagged-A-minor-to-G-minor.wav'),
    (Join-Path $choir 'examples\pitch-edit-metrics.json'),
    (Join-Path $choir 'examples\four-independent-real-registers.mid'),
    (Join-Path $choir 'examples\long-vowel-metrics.json'),
    (Join-Path $choir 'examples\single-source-metrics.json'),
    (Join-Path $choir 'examples\single-source-solo-bass.wav'),
    (Join-Path $choir 'examples\single-source-unison.wav'),
    (Join-Path $choir 'examples\single-source-four-written-parts.wav'),
    (Join-Path $choir 'examples\real-vowel-metrics.json'),
    (Join-Path $choir 'examples\vocalset\ATTRIBUTION.md'),
    (Join-Path $choir 'examples\vocalset\soprano-f1-a.wav'),
    (Join-Path $choir 'examples\vocalset\alto-f5-a.wav'),
    (Join-Path $choir 'examples\vocalset\tenor-m2-a.wav'),
    (Join-Path $choir 'examples\vocalset\bass-m8-a.wav'),
    (Join-Path $choir 'examples\vocalset\soprano-f1-long-a.wav'),
    (Join-Path $choir 'examples\vocalset\alto-f5-long-a.wav'),
    (Join-Path $choir 'examples\vocalset\tenor-m2-long-a.wav'),
    (Join-Path $choir 'examples\vocalset\bass-m8-long-a.wav'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Missing offline dependency: $required" }
}
if ((Get-Item $font).Length -lt 1000000) { throw 'Bundled MS Basic soundfont is too small.' }
$wav = Join-Path $env:RUNNER_TEMP 'portable-first-launch.wav'
if (Test-Path $wav) { Remove-Item $wav -Force }
# The runner is a clean Windows machine; block both launcher and application
# from reaching the network. Exporting audible notes from a fresh extracted
# package then verifies first-launch startup and the bundled soundfont.
$ruleLauncher = "MuseScore portable CI launcher $env:GITHUB_RUN_ID"
$ruleApp = "MuseScore portable CI app $env:GITHUB_RUN_ID"
try {
    New-NetFirewallRule -DisplayName $ruleLauncher -Direction Outbound -Action Block -Program $launcher | Out-Null
    New-NetFirewallRule -DisplayName $ruleApp -Direction Outbound -Action Block -Program $exe | Out-Null
    $args = @('--audio-output-disabled', 'true', '-o', ('"' + $wav + '"'), ('"' + $score + '"'))
    $process = Start-Process -FilePath $launcher -ArgumentList $args -WorkingDirectory $probe -PassThru
    try {
        if (-not $process.WaitForExit(180000)) {
            $process.Kill($true)
            throw 'Portable launcher did not complete the offline first-launch audio export in 180 seconds.'
        }
        if ($process.ExitCode -ne 0) { throw "Portable launcher exited with code $($process.ExitCode)" }
    } finally {
        $process.Dispose()
    }
    if (-not (Test-Path $wav)) { throw 'Portable launcher started but did not export a WAV.' }
    $bytes = [IO.File]::ReadAllBytes($wav)
    if ($bytes.Length -lt 8192 -or [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne 'RIFF') {
        throw 'Portable audio export is empty or not a WAV file.'
    }
    $dataFound = $false
    for ($offset = 12; $offset + 8 -le $bytes.Length;) {
        $size = [BitConverter]::ToUInt32($bytes, $offset + 4)
        if ([Text.Encoding]::ASCII.GetString($bytes, $offset, 4) -eq 'data') {
            if ($size -lt 4096) { throw 'The WAV contains no substantial audio.' }
            $dataFound = $true
            break
        }
        $offset += 8 + $size + ($size % 2)
    }
    if (-not $dataFound) { throw 'The WAV has no audio data chunk.' }
    & python3 (Join-Path $root 'tools\historical_performance\verify_wav.py') $wav
    if ($LASTEXITCODE -ne 0) { throw 'The bundled soundfont produced no verifiable audible samples.' }
    "Offline first-launch audio export succeeded using bundled MS Basic: $wav ($($bytes.Length) bytes)" |
        Tee-Object -FilePath $env:GITHUB_STEP_SUMMARY -Append
    "Extract-and-run package: $zip" | Tee-Object -FilePath $env:GITHUB_STEP_SUMMARY -Append
} finally {
    Remove-NetFirewallRule -DisplayName $ruleApp -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName $ruleLauncher -ErrorAction SilentlyContinue
}
