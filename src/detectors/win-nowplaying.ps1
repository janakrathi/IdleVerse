# Reads Windows' "now playing" media sessions (the same info shown in the volume flyout).
# Spotify, Apple Music for Windows and browsers all publish here.
# Prints one JSON line per second to stdout: { "sessions": [ ... ] }
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
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Wait-WinRt ($mgrType::RequestAsync()) $mgrType

while ($true) {
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
                }
            } catch { }
        }
    } catch { }
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 4 @{ sessions = @($list) }))
    [Console]::Out.Flush()
    if ($Once) { break }
    Start-Sleep -Milliseconds $IntervalMs
}
