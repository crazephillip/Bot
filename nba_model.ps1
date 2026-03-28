# nba_model.ps1 — NBA Prop Prediction Model
# Dot-source this file to use the functions:  . .\nba_model.ps1

function Get-StatValue($log, $statName) {
    switch ($statName) {
        "pts"      { return [double]$log.pts }
        "reb"      { return [double]$log.reb }
        "ast"      { return [double]$log.ast }
        "stl"      { return [double]$log.stl }
        "blk"      { return [double]$log.blk }
        "three_pm" { return [double]$log.three_pm }
        default    { return [double]$log.pts }
    }
}

function Get-Average($logs, $statName) {
    if (-not $logs -or $logs.Count -eq 0) { return 0 }
    $sum = 0
    $count = 0
    foreach ($l in $logs) {
        $sum += Get-StatValue $l $statName
        $count++
    }
    if ($count -eq 0) { return 0 }
    return $sum / $count
}

function Get-StdDev($logs, $statName) {
    if (-not $logs -or $logs.Count -lt 2) { return 3.0 }
    $avg = Get-Average $logs $statName
    $sumSq = 0
    foreach ($l in $logs) {
        $v = Get-StatValue $l $statName
        $sumSq += ($v - $avg) * ($v - $avg)
    }
    $variance = $sumSq / $logs.Count
    $sd = [Math]::Sqrt($variance)
    if ($sd -lt 0.1) { return 0.1 }
    return $sd
}

function Invoke-NormalCDF($z) {
    # Abramowitz & Stegun approximation (max error 7.5e-8)
    $t = 1.0 / (1.0 + 0.2316419 * [Math]::Abs($z))
    $poly = $t * (0.319381530 + $t * (-0.356563782 + $t * (1.781477937 + $t * (-1.821255978 + $t * 1.330274429))))
    $phi  = (1.0 / [Math]::Sqrt(2 * [Math]::PI)) * [Math]::Exp(-0.5 * $z * $z)
    $cdf  = 1.0 - $phi * $poly
    if ($z -lt 0) { $cdf = 1.0 - $cdf }
    return $cdf
}

function Invoke-PropModel {
    <#
    .SYNOPSIS
        Full NBA prop prediction model.
    .PARAMETER Gamelogs
        Array of game log objects for the target player.
    .PARAMETER Stat
        Stat to predict: pts, reb, ast, stl, blk, three_pm
    .PARAMETER Line
        The sportsbook prop line (numeric).
    .PARAMETER HomeAway
        "home" or "away" — affects home/away split calculation.
    .PARAMETER Opponent
        3-letter team abbreviation (e.g. "GSW"). Used for vs_opponent split.
    .PARAMETER BackToBack
        $true if this is a back-to-back game.
    .PARAMETER OppRank
        Opponent defensive rank 1-30 (1=best defense for this stat).
        If not provided, neutral adjustment is applied.
    #>
    param(
        [array]  $Gamelogs,
        [string] $Stat       = "pts",
        [double] $Line       = 20.5,
        [string] $HomeAway   = "home",
        [string] $Opponent   = "",
        [bool]   $BackToBack = $false,
        [int]    $OppRank    = 15
    )

    if (-not $Gamelogs -or $Gamelogs.Count -eq 0) {
        return $null
    }

    # Sort by date descending
    $sorted = $Gamelogs | Sort-Object date -Descending

    $last5Logs  = @($sorted | Select-Object -First 5)
    $last10Logs = @($sorted | Select-Object -First 10)
    $allLogs    = @($sorted)

    $last5avg   = Get-Average $last5Logs  $Stat
    $last10avg  = Get-Average $last10Logs $Stat
    $seasonavg  = Get-Average $allLogs    $Stat

    # Home/away split
    $splitLogs    = @($allLogs | Where-Object { $_.home_away -eq $HomeAway })
    $homeawayavg  = if ($splitLogs.Count -ge 3) { Get-Average $splitLogs $Stat } else { $seasonavg }

    # vs opponent split
    $vsLogs     = @()
    if ($Opponent -ne "") {
        $vsLogs = @($allLogs | Where-Object { $_.opponent -eq $Opponent })
    }
    $vsOpponent = if ($vsLogs.Count -ge 2) { Get-Average $vsLogs $Stat } else { $seasonavg }

    # Opponent rank adjustment
    # Rank 1 = elite defense (reduce predicted by ~8%), Rank 30 = bad defense (increase by ~8%)
    $oppAdjustFactor = 1.0 + (($OppRank - 15) / 15) * 0.08
    $oppAdjust = $seasonavg * $oppAdjustFactor

    # Weighted prediction
    $predicted = ($last5avg  * 0.35) `
               + ($last10avg * 0.20) `
               + ($seasonavg * 0.15) `
               + ($homeawayavg * 0.10) `
               + ($vsOpponent  * 0.15) `
               + ($oppAdjust   * 0.05)

    # Back-to-back penalty
    if ($BackToBack) {
        $predicted = $predicted * 0.92
    }

    # Standard deviation
    $stdDev = Get-StdDev $last10Logs $Stat

    # z-score and probability
    $zScore      = ($Line - $predicted) / $stdDev
    $ourProbOver = 1 - (Invoke-NormalCDF $zScore)

    # EV at standard -110 (implied prob = 0.524, payout = 0.909)
    $impliedProb = 0.524
    $ev = ($ourProbOver * 0.909) - ((1 - $ourProbOver) * 1.0)

    # Confidence grade
    $confidence = "C"
    if ([Math]::Abs($ev) -gt 0.10) { $confidence = "A" }
    elseif ([Math]::Abs($ev) -gt 0.07) { $confidence = "B" }

    # Kelly criterion (half Kelly recommended)
    $b     = 0.909  # net payout per $1
    $p     = $ourProbOver
    $q     = 1 - $p
    $kelly = 0
    if ($b -gt 0) { $kelly = ($b * $p - $q) / $b }
    if ($kelly -lt 0) { $kelly = 0 }
    $kellyHalf = $kelly * 0.5

    # Hit rates
    $over5  = 0; $over10 = 0; $over20 = 0
    $last5vals  = @()
    $last10vals = @()
    $last20vals = @()

    $top20 = @($sorted | Select-Object -First 20)
    for ($i = 0; $i -lt $top20.Count; $i++) {
        $v = Get-StatValue $top20[$i] $Stat
        if ($i -lt 5)  { $last5vals  += $v; if ($v -gt $Line) { $over5++ } }
        if ($i -lt 10) { $last10vals += $v; if ($v -gt $Line) { $over10++ } }
        $last20vals += $v
        if ($v -gt $Line) { $over20++ }
    }

    $hitRate5  = if ($last5vals.Count  -gt 0) { [Math]::Round($over5  / $last5vals.Count,  4) } else { 0 }
    $hitRate10 = if ($last10vals.Count -gt 0) { [Math]::Round($over10 / $last10vals.Count, 4) } else { 0 }
    $hitRate20 = if ($last20vals.Count -gt 0) { [Math]::Round($over20 / $last20vals.Count, 4) } else { 0 }

    return [PSCustomObject]@{
        stat         = $Stat
        line         = $Line
        predicted    = [Math]::Round($predicted,   2)
        last5avg     = [Math]::Round($last5avg,    2)
        last10avg    = [Math]::Round($last10avg,   2)
        seasonavg    = [Math]::Round($seasonavg,   2)
        homeawayavg  = [Math]::Round($homeawayavg, 2)
        vsOpponent   = [Math]::Round($vsOpponent,  2)
        std_dev      = [Math]::Round($stdDev,      2)
        z_score      = [Math]::Round($zScore,      4)
        our_prob     = [Math]::Round($ourProbOver, 4)
        implied_prob = $impliedProb
        ev           = [Math]::Round($ev,          4)
        confidence   = $confidence
        kelly        = [Math]::Round($kelly,        4)
        kelly_half   = [Math]::Round($kellyHalf,   4)
        hit_rate_5   = $hitRate5
        hit_rate_10  = $hitRate10
        hit_rate_20  = $hitRate20
        last5        = $last5vals
        last10       = $last10vals
        back_to_back = $BackToBack
        games_used   = $allLogs.Count
        opp_rank     = $OppRank
        home_away    = $HomeAway
    }
}

# Quick test function
function Test-Model($playerName, $stat, $line) {
    Write-Host "Model test: $playerName | $stat | Line: $line" -ForegroundColor Cyan
    $result = Invoke-PropModel -Gamelogs @() -Stat $stat -Line $line
    if ($result) {
        $result | Format-List
    } else {
        Write-Host "Not enough data." -ForegroundColor Yellow
    }
}
