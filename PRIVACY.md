# IdleVerse privacy policy

IdleVerse has no accounts, no analytics, no ads and no tracking. It runs on your computer and
sends nothing anywhere except the lookups described below, which you can switch off.

## What leaves your computer

To show lyrics, colours and the right design for the song that's playing, IdleVerse looks up
**the current song's details** online:

| Lookup | What is sent | Sent to | Why |
|---|---|---|---|
| Lyrics | Song title, artist, album and length | [LRCLIB](https://lrclib.net) (`lrclib.net`) | To get the song's time-synced lyrics |
| Genre and cover art | Song title and artist | Apple's [iTunes Search API](https://performance-partners.apple.com/search-api) (`itunes.apple.com`) | To learn the genre (for the design) and get the album cover if the music app didn't provide one |
| Cover art on Mac | Nothing beyond the request itself | Spotify's image server, using the cover address Spotify gives | To show the album cover for songs playing in Spotify on a Mac |

Like any web request, these services also see your IP address. They are run by others and have
their own policies: [Apple privacy policy](https://www.apple.com/legal/privacy/), [LRCLIB](https://lrclib.net),
[Spotify privacy policy](https://www.spotify.com/legal/privacy-policy/).

Nothing else is sent: no account details, no listening history, no information about your
computer, files or other apps.

## Turning the lookups off

Right-click the IdleVerse icon in the system tray (Windows) or menu bar (Mac) → **Privacy**:

- **Look up lyrics online (LRCLIB)**: untick to stop lyric lookups. The lyric screen then shows only the song title and cover.
- **Look up genre & cover art online (Apple iTunes)**: untick to stop genre and cover lookups. Colours then come only from the cover your music app provides (on Windows that comes straight from the app, with no network request).

## What stays on your computer

- **Settings** (idle time, design, timing offset, these privacy choices) in a small `settings.json` in your user profile.
- **Album covers** that Windows' media controls hand over, cached in a temporary folder (`%TEMP%\idleverse-art`).
- **Reading the current song:** IdleVerse reads what's playing from Windows' media controls, or on a Mac by asking the Spotify and Music apps. On a Mac, macOS asks your permission for this the first time.

## Uninstalling

**Windows:** Settings → Apps → IdleVerse → Uninstall. **Mac:** drag IdleVerse from Applications to the Bin.

## Questions

Open an issue at <https://github.com/janakrathi/IdleVerse/issues>.
