# DEGRE Mods for Sauce4Zwift

A collection of mods for [Sauce for Zwift](https://www.sauce.llc/) by **Luca De Gregorio**.

## Mods Included

### Power Bar
A dynamic power zone visualization bar that shows your current power output with official zone colors.

**Features:**
- Real-time power display with zone colors
- Stepped gradient with gap lines
- Vertical or horizontal orientation
- Configurable bar opacity
- Display W/kg or Watts
- Adjustable scale (max W/kg or Watts)
- Optional numeric values overlay

**Zone Colors:**
- Z1 Recovery: Gray (#666)
- Z2 Endurance: Blue (#24d)
- Z3 Tempo: Green (#5b5)
- Z4 Threshold: Yellow (#dd3)
- Z5 VO2max: Orange (#fa0)
- Z6 Anaerobic: Red (#b22)
- Z7 Neuromuscular: Purple (#a0b)

### Player
A mini music player connected to NowPlay playlists.

**Features:**
- Plays music from NowPlay playlists
- Album cover display
- Play/Pause, Next, Shuffle controls
- Volume control
- Progress bar (optional)
- Track info display (optional)
- Autoplay option

**Settings:**
- Playlist: Select from available NowPlay playlists
- Background opacity
- Show/hide track info
- Show/hide progress bar
- Shuffle mode
- Autoplay on window open
- Default volume

### Race Companion (NEW in v2.0.0)
A race finish countdown widget with attack detection and audio alerts.

**Features:**
- Distance to finish display (km or meters)
- Current position in race
- Attack detection for nearby riders
- Audio alerts:
  - "Allez Allez!" when others attack (>6 W/kg)
  - Personal incitement when you attack
  - Bell sound at last kilometer
- Visual attack indicator with attacker name/team
- Multiple attackers detection ("3 riders attacking!")
- Automatic state management (Not in Race → Racing → Finished)

**Settings:**
- Monitoring distance (when to start watching for attacks)
- Bell distance (when to play last km bell)
- Attack threshold (W/kg)
- Alert cooldown (prevent spam)
- Audio volume
- Enable/disable individual audio alerts

**Audio Files:**
Replace placeholder files in `/pages/audio/` with your own:
- `attack-others.mp3` - "Allez Allez!" sound
- `attack-me.mp3` - Personal incitement sound
- `last-km-bell.mp3` - Race bell sound

## Installation

1. Download the latest release
2. Extract to your SauceMods folder:
   - **Windows:** `C:\Users\<YourName>\Documents\SauceMods\`
   - **macOS/Linux:** `~/Documents/SauceMods/`
3. Restart Sauce for Zwift
4. Enable the mod windows from the Sauce menu

## Requirements

- Sauce for Zwift v1.0.0 or later
- A Zwift account with watcher access
- Internet connection (for Player to access NowPlay)

## Author

**Luca De Gregorio (Luca DEGRE)**
- Website: [lucadegregorio.it](https://lucadegregorio.it)

## License

MIT License - see [LICENSE](LICENSE) file.

## Changelog

### v2.7.4
- PowerBar: Fixed padding properly
  - CSS: removed conflicting position definitions (no top for vertical, no right for horizontal)
  - JS: removed width:100%/height:100% that overrode CSS positioning
  - Now CSS left/right (vertical) and top/bottom (horizontal) control the static dimension

### v2.7.3
- PowerBar: Fixed padding - all 4 positions defined for wrapper
  - Vertical: padding left, right, bottom (top=0 for bar growth)
  - Horizontal: padding left, top, bottom (right=0 for bar growth)
  - Removed generic padding rule that conflicted with absolute positioning

### v2.7.2
- PowerBar: Fixed padding bug from v2.7.1 - bars now correctly grow from bottom (vertical) and left (horizontal)
- PowerBar: Uses max-height/max-width instead of top/right anchoring to preserve growth direction

### v2.7.1
- PowerBar: Fixed padding in both orientations when background is visible
  - Vertical: now has padding on all 4 sides (was missing)
  - Horizontal: now has padding on all 4 sides (was missing right)

### v2.7.0
- DS: Removed audioCooldown setting (redundant - Sauce data arrives at ~1sec intervals)
- DS: Simplified playAudio() function

### v2.6.9
- DS: Same visibility approach as PowerBar - opacity 0.02 on container when dimmed
- DS: Hover reveals full widget at opacity 1
- DS: Simplified and consistent with PowerBar behavior

### v2.6.8
- DS: Dimmed state now uses rgba(255,255,255,0.03) - practically invisible
- DS: Hover reveals at 60% opacity
- DS: Fixed settings labels: "Show distance under:" and "Detect attacks under:"

### v2.6.7
- DS: New visibility logic with "dimmed" state
  - Hidden: shows "----" in dark grey (#333), barely visible but hoverable
  - On hover: grey lightens to #888
  - Active (in race final km): bright white with text effects
- DS: Removed broken ds-hidden opacity approach

### v2.6.6
- DS: Removed ds-hidden class entirely - widget is always visible like Dosenhuhn's
- DS: Padding-right increased to 20%
- DS: Simplified visibility logic - just shows "----" when not in race

### v2.6.5
- DS: Fixed visibility bug - widget now always visible (no more ds-hidden class issues)
- DS: Shows "----" when not in race, actual distance when in final km
- Removed Race Companion (legacy) - DS is the replacement

### v2.6.4
- DS: Increased right padding to 20%
- DS: Fixed visibility issue with transparent background - widget now stays visible (shows "----") when transparent, so user can always find it and access settings

### v2.6.2
- DS: Larger distance numbers (72-150px instead of 48-120px)
- DS: Distance display better centered (85% width with right padding)

### v2.6.1
- DS: Now uses Sauce 'groups' endpoint instead of manual group calculation
- DS: Attack detection uses Dosenhuhn-style logic (configurable thresholds)
- DS: Removed gapSlot setting (Sauce handles grouping)
- DS: Added attackPowerHigh (650W default) - above this = always attack
- DS: Added attackPowerLow (400W default) - above this AND >2x group avg = attack
- DS: Added configurable colors for opponent/teammate banners
- DS: Uses athlete.team from Sauce for team detection
- DS: Excludes own attacks from detection

### v2.6.0
- NEW WIDGET: DEGRE DS (Directeur Sportif)
  - Simplified UI: metres remaining + attack banners
  - Monospaced italic font, right-aligned
  - Proportional attack boxes (30-70% min/max for mixed attacks)
  - Configurable visibility: "Always" checkbox or distance threshold
  - Separate attack detector distance from visibility distance
  - Audio preview buttons in settings (▶)
  - Language selector (EN/IT/FR/ES)
  - Opacity and background controls
  - Hover shows hidden widget at full opacity
- Race Companion marked as legacy

### v2.5.5
- PowerBar: Hover on hidden widget now always restores full opacity (1), regardless of opacity setting

### v2.5.4
- PowerBar: Fixed hover detection when hidden - uses tiny opacity (0.02) instead of 0

### v2.5.3
- PowerBar: Opacity now applies to entire widget (background + bars), not just bars
- PowerBar: Renamed "Bar opacity" to "Opacity" in settings
- PowerBar: When "Hide if not racing" is active, widget reappears on mouse hover

### v2.5.2
- PowerBar: Default background color changed to Zwift blue (#283f57)
- All widgets: Updated default_bounds to better positions/sizes
  - PowerBar: 144x684 at (235, 202)
  - Player: 250x250 at (1173, 51)
  - Race Companion: 609x189 at (650, 329)

### v2.5.1
- PowerBar: Default background is now NOT transparent (black) for better visibility

### v2.5.0
- PowerBar: Removed watt/w/kg numeric display (simplified UI)
- PowerBar: Removed VALUES DISPLAY section from settings
- PowerBar: Added padding when background is not transparent
- PowerBar: Larger bars (+50%): 18px bars with 6px gaps
- PowerBar: Background color picker now grayed out when Transparent is checked
- PowerBar: Settings reorganized - "Background color: [picker] Transparent [checkbox]"
- PowerBar: Settings window now 400x680px

### v2.4.6
- Race Companion: Wider number input fields in settings (55px)

### v2.4.5
- Race Companion: Widget stays visible when background is NOT transparent
- Race Companion: Shows #-- and ----m when not in race (if background visible)
- This allows positioning the widget before entering a race

### v2.4.4
- Race Companion: Added configurable background (color + transparent toggle)
- Race Companion: Default background is BLACK (not transparent) for easier positioning
- Race Companion: Added color picker support with manual event listeners
- Race Companion: Fixed close button icon in settings

### v2.4.3
- PowerBar: Added manual event listeners for color picker inputs
- PowerBar: Settings now read directly from localStorage
- This should fix zone colors and background color not updating

### v2.4.2
- PowerBar: Fixed bar showing 100% always - now follows actual power again
- PowerBar: Added polling fallback for settings sync between windows
- PowerBar: Added debug logging to console

### v2.4.1
- PowerBar: Removed ugly orange border, shows 100% bar when no signal instead
- PowerBar: Wider number input fields in settings
- Race Companion: Removed orange border, semi-transparent dark background
- Fixed close button icon in PowerBar settings

### v2.4.0
- Race Companion: Added orange border for visibility when empty
- Race Companion: Shows standby state (#-- / ----m) instead of being invisible
- Race Companion: Now visible immediately when added to stage

### v2.3.9
- PowerBar: Added orange border for visibility when empty
- PowerBar: Added minimum size to wrapper (always visible)
- Player: Settings window height increased to 200px

### v2.3.8
- Player: Fixed settings window - added close button and dark theme

### v2.3.7
- Player: Controls and volume visible when music is paused (not just on hover)

### v2.3.6
- Player: Fixed album field name (album_name from NowPlay API)

### v2.3.5
- Player: Fixed bottom bar to show album title instead of playlist name

### v2.3.4
- Player: Square layout (cover fills entire widget)
- Player: Top bar with copyright banner (scrolling, multilingual)
- Player: Bottom bar with track title + album (scrolling if needed)
- Player: Playlist selector appears on hover of bottom bar (overlay)
- Player: Volume slider moved higher
- Player: Compact settings window (single row)

### v2.3.3
- All widgets: Fixed titlebar icons (now using SVG instead of Material Symbols)
- Titlebar now shows proper gear icon for settings and X for close

### v2.3.2
- Player: New layout - track info moved to bottom bar
- Player: Title + Album scroll only when needed (conditional scrolling)
- Player: Removed dark overlay on cover (clean cover image)
- Player: Bottom bar always visible with track info
- Player: Playlist selector appears on hover

### v2.3.1
- Player: Fixed default playlist (now loads 'Zwift Time' on start)
- Player: Improved text readability with dark gradient band behind titles
- Player: Playlist selector now fully transparent
- Player: Fixed titlebar button styling

### v2.3.0
- Player: Complete redesign with modern UI
- Player: Cover art as background (not blurred)
- Player: Top marquee bar always visible with "Now Playing" scroll
- Player: Track title + album always visible in center
- Player: Controls, volume, playlist selector hidden by default → appear on hover
- Player: Playlist selector integrated directly in widget (no need for settings)
- Player: Play tracking after 10 seconds (NowPlay API)
- Player: Visibility option: "Always" or "Only during races"
- Player: Simplified settings (language + visibility only)
- Player: Default size 250x300px

### v2.2.0
- Race Companion: Complete rewrite with new behavior
- Race Companion: Widget invisible until visibility threshold (default 2000m)
- Race Companion: Shows position in GRUPPETTO (e.g. #4/12) not full race
- Race Companion: Gruppetto algorithm with gap slots (default 2s)
- Race Companion: Attack detection only within gruppetto
- Race Companion: Orange background for enemy attack
- Race Companion: Blue background for team attack  
- Race Companion: Split vertical (orange/blue) for mixed attack
- Race Companion: My own attack = audio only, no visual
- Race Companion: Customizable colors (RGB picker)
- Race Companion: 5 audio alerts (others, team, mixed, bell, applause)
- Race Companion: Finish state with final race position
- Race Companion: Compact settings with tooltips
- Race Companion: Multilingual (EN/IT/FR/ES)
- Race Companion: Monospace font (Roboto Mono) for stable numbers

### v2.1.0
- Power Bar: Customizable zone thresholds (W/kg) in settings
- Power Bar: Customizable zone colors (RGB picker) in settings
- Power Bar: Background color option (transparent or custom RGB)
- Power Bar: "Hide when not racing" option (based on event position)
- Power Bar: White glow effect when above Z7 threshold
- Power Bar: Monospace font (Roboto Mono) for stable number display
- Power Bar: Fixed-width number display (no more jumping/shifting)

### v2.0.9
- Race Companion: Larger checkered pattern (30x30px, 10% contrast)
- Race Companion: Horizontal layout - Position LEFT, Distance RIGHT on same line
- Race Companion: Attack alert now fills entire widget (ORANGE=enemy, GREEN=team)
- Race Companion: New "Team Race" mode - detects team tags [TAG], (TAG), <TAG>
- Race Companion: Attacker name shown in fixed area below (no layout shift)
- Race Companion: Numbers positioned higher to leave room for attacker name

### v2.0.8
- Race Companion: Checkered background pattern (subtle dark/light squares)
- Race Companion: Orange border (Zwift color)

### v2.0.7
- Race Companion: Monospace font for numbers (Roboto Mono) - no more jittering
- Race Companion: Removed useless "Last Kilometer" blue alert (bell is enough)
- Race Companion: Attack alert now more visible (bigger, red, pulsing)
- Race Companion: Attack alert stays inside widget boundaries
- Race Companion: Added background opacity setting
- Race Companion: Added subtle border (follows opacity)
- Race Companion: Position (#) now larger and brighter

### v2.0.6
- Race Companion: Text now scales with window size (uses min(vh, vw) instead of clamp)
- Race Companion: Position (#) more visible (larger, lighter color #ccc instead of #888)
- Race Companion: Added CSS version string to prevent caching issues

### v2.0.5
- Race Companion: More compact settings page (removed hints, shorter labels)
- Race Companion: Reduced padding and margins throughout

### v2.0.4
- Race Companion: Much more compact layout (less wasted space)
- Race Companion: Smaller default window size (160x100)
- Race Companion: Removed unnecessary container wrapper

### v2.0.3
- Race Companion: Fixed settings page (standard Sauce structure)
- Race Companion: Added multilingual support (EN/IT/FR/ES)
- Race Companion: Volume slider now updates correctly
- Race Companion: Removed unnecessary audio files info box

### v2.0.2
- Race Companion: Fixed responsive layout (proper flex structure like player)
- Race Companion: Widget now scales correctly when resized

### v2.0.1
- Race Companion: Fixed window titlebar (right-click to move)
- Race Companion: Fixed audio paths

### v2.0.0
- Added DEGRE Race Companion
  - Distance countdown to finish
  - Position tracking
  - Attack detection with audio alerts
  - Last kilometer bell
  - Automatic finish detection

### v1.2.3
- Player: Fixed title centering, updated banner text

### v1.1.0
- Added DEGRE Player (NowPlay integration)

### v1.0.3
- Power Bar: Fixed gradient to stepped blocks with gap lines
- Power Bar: Restored bar opacity setting

### v1.0.2
- Power Bar: Fixed gradient to stay fixed while bar grows

### v1.0.1
- Power Bar: Fixed transparency and gradient behavior

### v1.0.0
- Initial release
- Power Bar with full customization
