# fetch_nba.ps1 — NBA Data Fetcher using ESPN API (2025-26 season, no API key)
# Runs in its own PowerShell window, loops every 15 minutes

$ErrorActionPreference = "SilentlyContinue"
$RootDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir  = Join-Path $RootDir "data"
$Season   = "2026"   # ESPN uses the end-year of the season (2025-26 = 2026)

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   NBA Data Fetcher (ESPN API - 2025-26)" -ForegroundColor Cyan
Write-Host "   Polling every 15 minutes" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ── Helpers ──────────────────────────────────────────────────────────────────

function Read-Data($file) {
    $path = Join-Path $DataDir "$file.json"
    if (-not (Test-Path $path)) { return @() }
    try {
        $c = [System.IO.File]::ReadAllText($path)
        if ([string]::IsNullOrWhiteSpace($c)) { return @() }
        return $c | ConvertFrom-Json
    } catch { return @() }
}

function Save-Data($file, $data) {
    $path = Join-Path $DataDir "$file.json"
    try {
        $data | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
        Write-Host "  [SAVED] $file.json" -ForegroundColor DarkGreen
    } catch { Write-Host "  [ERROR] Could not save $file.json : $_" -ForegroundColor Red }
}

function Get-ESPN($url) {
    try {
        return Invoke-RestMethod -Uri $url -TimeoutSec 15 -ErrorAction Stop
    } catch {
        Write-Host "  [API ERR] $url" -ForegroundColor DarkRed
        return $null
    }
}

# Stat label index positions in ESPN gamelog stats array:
# MIN, FG, FG%, 3PT, 3P%, FT, FT%, REB, AST, BLK, STL, PF, TO, PTS
$IDX_MIN = 0; $IDX_3PT = 3; $IDX_REB = 7; $IDX_AST = 8
$IDX_BLK = 9; $IDX_STL = 10; $IDX_PTS = 13

function Parse-3PM($threeStr) {
    # "3-7" -> 3
    try { return [int]($threeStr.ToString().Split('-')[0]) } catch { return 0 }
}

function Parse-Min($minStr) {
    # "34" or "34:22" -> 34
    try { return [int]($minStr.ToString().Split(':')[0]) } catch { return 0 }
}

# ── Fetch player game logs from ESPN ──────────────────────────────────────────

function Fetch-PlayerLogs($espnId, $playerName, $team) {
    $url  = "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/$espnId/gamelog?season=$Season"
    $resp = Get-ESPN $url
    if (-not $resp) { return @() }

    # Stats live in: seasonTypes[0].categories[0].events[] -> {eventId, stats[]}
    # Game metadata: events PSObject with eventId as property name
    $statEvents = @()
    if ($resp.seasonTypes -and $resp.seasonTypes.Count -gt 0) {
        foreach ($st in $resp.seasonTypes) {
            if ($st.categories) {
                foreach ($cat in $st.categories) {
                    if ($cat.events -and $cat.events.Count -gt 0) {
                        $statEvents = $cat.events
                        break
                    }
                }
                if ($statEvents.Count -gt 0) { break }
            }
        }
    }

    $eventLookup = $resp.events  # PSObject: key = eventId

    $logs = @()
    foreach ($se in $statEvents) {
        $eid   = $se.eventId
        $stats = $se.stats
        if (-not $stats -or $stats.Count -lt 14) { continue }

        $gameDate = ""
        $opponent = ""
        $homeAway = "home"

        if ($eventLookup) {
            $meta = $eventLookup.PSObject.Properties[$eid]
            if ($meta) {
                $m = $meta.Value
                try { $gameDate = ([datetime]::Parse($m.gameDate)).ToString("yyyy-MM-dd") } catch {}
                if ($m.opponent) { $opponent = $m.opponent.abbreviation }
                if ($m.atVs -eq "@") { $homeAway = "away" }
            }
        }

        $sPts  = 0; try { $sPts  = [int]$stats[$IDX_PTS] } catch {}
        $sReb  = 0; try { $sReb  = [int]$stats[$IDX_REB] } catch {}
        $sAst  = 0; try { $sAst  = [int]$stats[$IDX_AST] } catch {}
        $sStl  = 0; try { $sStl  = [int]$stats[$IDX_STL] } catch {}
        $sBlk  = 0; try { $sBlk  = [int]$stats[$IDX_BLK] } catch {}
        $s3pm  = 0; try { $s3pm  = Parse-3PM $stats[$IDX_3PT] } catch {}
        $sMin  = 0; try { $sMin  = Parse-Min $stats[$IDX_MIN] } catch {}

        $logs += [pscustomobject]@{
            player_id   = $espnId
            player_name = $playerName
            team        = $team
            date        = $gameDate
            pts         = $sPts
            reb         = $sReb
            ast         = $sAst
            stl         = $sStl
            blk         = $sBlk
            three_pm    = $s3pm
            min         = $sMin
            opponent    = $opponent
            home_away   = $homeAway
        }
    }

    Write-Host "    -> $($logs.Count) games" -ForegroundColor Gray
    return $logs
}

# ── Fetch today's scoreboard ───────────────────────────────────────────────────

function Fetch-TodaysGames() {
    $today = (Get-Date).ToString("yyyyMMdd")
    $resp  = Get-ESPN "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=$today"
    if (-not $resp -or -not $resp.events) { return @() }

    $games = @()
    foreach ($ev in $resp.events) {
        $comp = if ($ev.competitions) { $ev.competitions[0] } else { $null }
        if (-not $comp) { continue }

        $homeTeam = ""; $awayTeam = ""; $gameTime = ""
        if ($comp.competitors) {
            foreach ($c in $comp.competitors) {
                if ($c.homeAway -eq "home") { $homeTeam = $c.team.abbreviation }
                else                        { $awayTeam = $c.team.abbreviation }
            }
        }
        try { $gameTime = ([datetime]::Parse($ev.date)).ToLocalTime().ToString("h:mm tt") } catch {}

        $games += [pscustomobject]@{
            id     = $ev.id
            name   = $ev.shortName
            home   = $homeTeam
            away   = $awayTeam
            time   = $gameTime
            status = $ev.status.type.description
        }
    }
    return $games
}

# ── Prop prediction model ──────────────────────────────────────────────────────

function NormalCDF($z) {
    $sign = if ($z -lt 0) { -1 } else { 1 }
    $z    = [Math]::Abs($z)
    $t    = 1.0 / (1.0 + 0.2316419 * $z)
    $d    = 0.3989422823 * [Math]::Exp(-0.5 * $z * $z)
    $p    = $d * $t * (0.3193815 + $t * (-0.3565638 + $t * (1.7814779 + $t * (-1.8212560 + $t * 1.3302744))))
    if ($sign -gt 0) { return 1.0 - $p } else { return $p }
}

function Run-PropModel($playerName, $espnId, $team, $statKey, $line, $logs, $opponent) {
    $playerLogs = @($logs | Where-Object { $_.player_id -eq $espnId } | Sort-Object date -Descending)
    if ($playerLogs.Count -lt 3) { return $null }

    $vals = @($playerLogs | Select-Object -First 20 | ForEach-Object { [double]$_.$statKey })
    if ($vals.Count -lt 3) { return $null }

    $n      = $vals.Count
    $last5  = if ($n -ge 5)  { ($vals[0..4]  | Measure-Object -Sum).Sum / 5  } else { ($vals | Measure-Object -Sum).Sum / $n }
    $last10 = if ($n -ge 10) { ($vals[0..9]  | Measure-Object -Sum).Sum / 10 } else { ($vals | Measure-Object -Sum).Sum / $n }
    $season = ($vals | Measure-Object -Sum).Sum / $n

    # Standard deviation
    $mean   = $season
    $sq     = ($vals | ForEach-Object { ($_ - $mean) * ($_ - $mean) } | Measure-Object -Sum).Sum
    $stddev = if ($n -gt 1) { [Math]::Sqrt($sq / ($n - 1)) } else { 2.5 }
    if ($stddev -lt 0.5) { $stddev = 0.5 }

    # vs opponent average
    $vsOpp = $season
    $oppLogs = @($playerLogs | Where-Object { $_.opponent -eq $opponent })
    if ($oppLogs.Count -ge 2) {
        $oppVals = @($oppLogs | ForEach-Object { [double]$_.$statKey })
        $vsOpp   = ($oppVals | Measure-Object -Sum).Sum / $oppVals.Count
    }

    # Weighted prediction: heavily weights recent form
    $predicted = ($last5 * 0.35) + ($last10 * 0.20) + ($season * 0.20) + ($vsOpp * 0.25)

    # Probability OVER
    $z        = ($line - $predicted) / $stddev
    $probOver = 1.0 - (NormalCDF $z)

    # EV at standard -110 odds
    $ev = ($probOver * 0.909) - ((1 - $probOver) * 1.0)

    # Confidence
    $confidence = if ([Math]::Abs($ev) -gt 0.10) { "A" } elseif ([Math]::Abs($ev) -gt 0.07) { "B" } else { "C" }

    # Hit rates
    $l5v  = @($vals | Select-Object -First 5)
    $l10v = @($vals | Select-Object -First 10)
    $hr5  = if ($l5v.Count  -gt 0) { [Math]::Round(($l5v  | Where-Object { $_ -gt $line } | Measure-Object).Count / $l5v.Count  * 100) } else { 0 }
    $hr10 = if ($l10v.Count -gt 0) { [Math]::Round(($l10v | Where-Object { $_ -gt $line } | Measure-Object).Count / $l10v.Count * 100) } else { 0 }

    return [pscustomobject]@{
        player_name  = $playerName
        player_id    = $espnId
        team         = $team
        opponent     = $opponent
        stat         = $statKey
        line         = $line
        predicted    = [Math]::Round($predicted, 1)
        our_prob     = [Math]::Round($probOver, 3)
        implied_prob = 0.524
        ev           = [Math]::Round($ev, 3)
        confidence   = $confidence
        hit_rate_5   = $hr5
        hit_rate_10  = $hr10
        last5        = @($l5v)
        date         = (Get-Date).ToString("yyyy-MM-dd")
    }
}

# ── Player list with correct 2025-26 ESPN IDs and teams ───────────────────────

$DefaultPlayers = @(
    [pscustomobject]@{ id="1966";    name="LeBron James";           team="CLE"; position="F" },
    [pscustomobject]@{ id="3975";    name="Stephen Curry";          team="GSW"; position="G" },
    [pscustomobject]@{ id="3136193"; name="Luka Doncic";            team="LAL"; position="G" },
    [pscustomobject]@{ id="3032977"; name="Giannis Antetokounmpo";  team="MIL"; position="F" },
    [pscustomobject]@{ id="3059318"; name="Jayson Tatum";           team="BOS"; position="F" },
    [pscustomobject]@{ id="4065648"; name="Shai Gilgeous-Alexander";team="OKC"; position="G" },
    [pscustomobject]@{ id="4277905"; name="Cade Cunningham";        team="DET"; position="G" },
    [pscustomobject]@{ id="3134907"; name="Donovan Mitchell";       team="CLE"; position="G" },
    [pscustomobject]@{ id="4432816"; name="Victor Wembanyama";      team="SAS"; position="C" },
    [pscustomobject]@{ id="4066648"; name="Tyrese Haliburton";      team="IND"; position="G" }
)

# Approximate prop lines — model compares your real lines when you enter them in the UI
$DefaultLines = @{
    "pts" = @{ "LeBron James"=22.5; "Stephen Curry"=23.5; "Luka Doncic"=28.5; "Giannis Antetokounmpo"=29.5;
               "Jayson Tatum"=26.5; "Shai Gilgeous-Alexander"=30.5; "Cade Cunningham"=24.5;
               "Donovan Mitchell"=25.5; "Victor Wembanyama"=22.5; "Tyrese Haliburton"=19.5 }
    "reb" = @{ "LeBron James"=7.5;  "Stephen Curry"=4.5;  "Luka Doncic"=8.5;  "Giannis Antetokounmpo"=11.5;
               "Jayson Tatum"=8.5;  "Shai Gilgeous-Alexander"=4.5;  "Cade Cunningham"=5.5;
               "Donovan Mitchell"=4.5; "Victor Wembanyama"=10.5; "Tyrese Haliburton"=4.5 }
    "ast" = @{ "LeBron James"=7.5;  "Stephen Curry"=5.5;  "Luka Doncic"=7.5;  "Giannis Antetokounmpo"=5.5;
               "Jayson Tatum"=4.5;  "Shai Gilgeous-Alexander"=5.5;  "Cade Cunningham"=8.5;
               "Donovan Mitchell"=4.5; "Victor Wembanyama"=3.5; "Tyrese Haliburton"=8.5 }
}

# ── Main fetch loop ────────────────────────────────────────────────────────────

function Run-Fetch() {
    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting NBA data fetch (2025-26 season)..." -ForegroundColor Cyan

    # Load players directly (avoid function pipeline unrolling in PS 5.1)
    $playersPath = Join-Path $DataDir "nba_players.json"
    $players = New-Object System.Collections.ArrayList
    if (Test-Path $playersPath) {
        $pJson   = [System.IO.File]::ReadAllText($playersPath)
        $pParsed = $pJson | ConvertFrom-Json
        $pParsed | ForEach-Object { [void]$players.Add($_) }
    }
    if ($players.Count -eq 0) {
        $DefaultPlayers | ForEach-Object { [void]$players.Add($_) }
        $DefaultPlayers | ConvertTo-Json -Depth 5 | Set-Content $playersPath -Encoding UTF8
        Write-Host "  Seeded 2025-26 player list" -ForegroundColor Yellow
    }

    # Fetch game logs
    $logsPath     = Join-Path $DataDir "nba_gamelogs.json"
    $existingLogs = New-Object System.Collections.ArrayList
    if (Test-Path $logsPath) {
        $lJson   = [System.IO.File]::ReadAllText($logsPath)
        $lParsed = $lJson | ConvertFrom-Json
        $lParsed | ForEach-Object { [void]$existingLogs.Add($_) }
    }
    $allLogs = New-Object System.Collections.ArrayList

    # Use index-based loop to avoid PS 5.1 foreach/array quirks
    for ($pi = 0; $pi -lt $players.Count; $pi++) {
        $p = $players[$pi]
        $playerId  = [string]$p.id
        $pnam = [string]$p.name
        $ptm  = [string]$p.team
        Write-Host "  [$($pi+1)/$($players.Count)] $pnam ($ptm)..." -ForegroundColor White
        $newLogs = @(Fetch-PlayerLogs $playerId $pnam $ptm)
        if ($newLogs.Count -gt 0) {
            $existingLogs | Where-Object { $_.player_id -ne $playerId } | ForEach-Object { [void]$allLogs.Add($_) }
            $newLogs | ForEach-Object { [void]$allLogs.Add($_) }
        } else {
            $existingLogs | Where-Object { $_.player_id -eq $playerId } | ForEach-Object { [void]$allLogs.Add($_) }
            Write-Host "    Using cached data" -ForegroundColor Yellow
        }
        Start-Sleep -Seconds 1
    }

    if ($allLogs.Count -gt 0) {
        Save-Data "nba_gamelogs" $allLogs
        Write-Host "  Total logs stored: $($allLogs.Count)" -ForegroundColor Green
    }

    # Today's games
    Write-Host "  Fetching today's schedule..." -ForegroundColor White
    $todaysGames = @(Fetch-TodaysGames)
    if ($todaysGames.Count -gt 0) {
        Save-Data "nba_today_games" $todaysGames
        Write-Host "  Games today: $($todaysGames.Count)" -ForegroundColor Green
        foreach ($g in $todaysGames) {
            Write-Host "    $($g.away) @ $($g.home) $($g.time)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  No games today (or off day)" -ForegroundColor Yellow
    }

    # Generate picks
    Write-Host "  Generating picks..." -ForegroundColor White
    $picks    = New-Object System.Collections.ArrayList
    $statKeys = @("pts", "reb", "ast")

    for ($pi = 0; $pi -lt $players.Count; $pi++) {
        $p    = $players[$pi]
        $playerId  = [string]$p.id
        $pnam = [string]$p.name
        $ptm  = [string]$p.team

        foreach ($sk in $statKeys) {
            $line = $null
            if ($DefaultLines[$sk] -and $DefaultLines[$sk][$pnam]) {
                $line = $DefaultLines[$sk][$pnam]
            }
            if (-not $line) { continue }

            $opp = "OPP"
            for ($gi = 0; $gi -lt $todaysGames.Count; $gi++) {
                $g = $todaysGames[$gi]
                if ($g.home -eq $ptm -or $g.away -eq $ptm) {
                    $opp = if ($g.home -eq $ptm) { $g.away } else { $g.home }
                    break
                }
            }

            $pick = Run-PropModel $pnam $playerId $ptm $sk $line ($allLogs.ToArray()) $opp
            if ($pick -and $pick.ev -gt 0.03) { [void]$picks.Add($pick) }
        }
    }

    $picks = @($picks.ToArray() | Sort-Object ev -Descending | Select-Object -First 15)

    if ($picks.Count -gt 0) {
        Save-Data "nba_picks" $picks
        Write-Host "  Value picks saved: $($picks.Count)" -ForegroundColor Green
        foreach ($pk in ($picks | Select-Object -First 5)) {
            $dir = if ($pk.our_prob -gt 0.5) { "OVER" } else { "UNDER" }
            Write-Host "    $($pk.player_name) $($pk.stat.ToUpper()) $dir $($pk.line) | EV: +$([Math]::Round($pk.ev*100,1))% | $($pk.confidence)" -ForegroundColor Cyan
        }
    } else {
        Write-Host "  No value picks today (EV < 3%)" -ForegroundColor Yellow
    }

    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Done. Sleeping 15 min..." -ForegroundColor Green
}

# Run immediately, then every 15 minutes
while ($true) {
    Run-Fetch
    Start-Sleep -Seconds 900
}
