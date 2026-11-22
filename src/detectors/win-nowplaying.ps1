# Reads Windows' "now playing" media sessions (the same info shown in the volume flyout).
# Spotify, Apple Music for Windows and browsers all publish here.
#
# Output: one JSON line every IntervalMs: { "sessions": [ { app, title, artist, album,
#         playing, positionMs, durationMs, artPath } ] }
# Input:  commands on stdin, one per line: "toggle|next|prev<TAB><app id>"
# The script exits when stdin closes (i.e. when the app quits).
param([int]$IntervalMs = 1000, [switch]$Once)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Wait-WinRt($op, [Type]$resultType) {
    $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asStreamForRead = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$mgr = Wait-WinRt ($mgrType::RequestAsync()) $mgrType

$artDir = Join-Path $env:TEMP 'idleverse-art'
New-Item -ItemType Directory -Force $artDir | Out-Null
$artCache = @{}   # "app|title|artist" -> @{ first = time first seen; path = artwork file }
$md5 = [System.Security.Cryptography.MD5]::Create()

# Album artwork. Music apps often swap in the new cover a moment AFTER the title changes,
# so keep re-reading it for the first few seconds of each song. Files are named by a hash of
# the image itself, so the path changes whenever the picture does.
function Get-ArtPath($session, $props) {
    $key = "$($session.SourceAppUserModelId)|$($props.Title)|$($props.Artist)"
    $e = $artCache[$key]
    if ($e -and ([DateTime]::Now - $e.first).TotalSeconds -gt 6) { return $e.path }
    if (-not $e) { $e = @{ first = [DateTime]::Now; path = '' }; $artCache[$key] = $e }
    try {
        if ($props.Thumbnail) {
            $winStream = Wait-WinRt ($props.Thumbnail.OpenReadAsync()) $streamType
            # PowerShell can't bind WinRT streams itself, so call the .NET converter via reflection.
            $src = $asStreamForRead.Invoke($null, @($winStream))
            $ms = New-Object System.IO.MemoryStream
            try { $src.CopyTo($ms) } finally { $src.Dispose() }
            $bytes = $ms.ToArray()
            if ($bytes.Length -gt 0) {
                $sum = [BitConverter]::ToString($md5.ComputeHash($bytes)).Replace('-', '').Substring(0, 20)
                $path = Join-Path $artDir "$sum.img"
                if (-not (Test-Path $path)) { [System.IO.File]::WriteAllBytes($path, $bytes) }
                $e.path = $path
            }
        }
    } catch { }
    return $e.path
}

function Find-Session($appId) {
    foreach ($s in $mgr.GetSessions()) { if ($s.SourceAppUserModelId -eq $appId) { return $s } }
    return $mgr.GetCurrentSession()
}

function Invoke-Command($line) {
    $parts = $line.Split("`t")
    $s = Find-Session $parts[1]
    if (-not $s) { return }
    $op = switch ($parts[0]) {
        'toggle' { $s.TryTogglePlayPauseAsync() }
        'next'   { $s.TrySkipNextAsync() }
        'prev'   { $s.TrySkipPreviousAsync() }
    }
    if ($op) { $null = Wait-WinRt $op ([bool]) }
}

function Publish {
    $list = @()
    try {
        foreach ($s in $mgr.GetSessions()) {
            try {
                $props = Wait-WinRt ($s.TryGetMediaPropertiesAsync()) $propsType
                $info = $s.GetPlaybackInfo()
                $tl = $s.GetTimelineProperties()
                $isPlaying = ($info.PlaybackStatus.ToString() -eq 'Playing')
                $pos = $tl.Position.TotalMilliseconds
                if ($isPlaying -and $tl.LastUpdatedTime.Year -gt 2000) {
                    $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalMilliseconds
                }
                $list += [ordered]@{
                    app        = $s.SourceAppUserModelId
                    title      = $props.Title
                    artist     = $props.Artist
                    album      = $props.AlbumTitle
                    playing    = $isPlaying
                    positionMs = [int64]$pos
                    durationMs = [int64]$tl.EndTime.TotalMilliseconds
                    artPath    = (Get-ArtPath $s $props)
                }
            } catch { }
        }
    } catch { }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 @{ sessions = @($list) }))
    [Console]::Out.Flush()
}

if ($Once) { Publish; exit }

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$next = [DateTime]::MinValue
while ($true) {
    if ($pending.IsCompleted) {
        $cmd = $pending.Result
        if ($null -eq $cmd) { exit }            # app closed our stdin -> quit
        try { Invoke-Command $cmd } catch { }
        $pending = $stdin.ReadLineAsync()
        $next = [DateTime]::Now.AddMilliseconds(250)   # report the new state quickly
    }
    if ([DateTime]::Now -ge $next) {
        Publish
        $next = [DateTime]::Now.AddMilliseconds($IntervalMs)
    }
    Start-Sleep -Milliseconds 60
}
