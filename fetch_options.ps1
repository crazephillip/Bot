# fetch_options.ps1 — Standalone Options Data Fetcher
# Runs in its own PowerShell window, loops every 60 seconds

$ErrorActionPreference = "SilentlyContinue"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = Join-Path $RootDir "data"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Options Data Fetcher" -ForegroundColor Cyan
Write-Host "   Polling every 60 seconds" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

function Read-Watchlist() {
    $path = Join-Path $DataDir "watchlist.json"
    if (-not (Test-Path $path)) { return @() }
    try {
        $content = Get-Content $path -Raw
        if ([string]::IsNullOrWhiteSpace($content)) { return @() }
        return $content | ConvertFrom-Json
    } catch { return @() }
}

function Save-Json($path, $data) {
    try {
        $data | ConvertTo-Json -Depth 10 | Set-Content -Path $path -Encoding UTF8
    } catch {
        Write-Host "[ERROR] Could not save $path : $_" -ForegroundColor Red
    }
}

function Load-Json($path) {
    if (-not (Test-Path $path)) { return $null }
    try {
        $content = Get-Content $path -Raw
        if ([string]::IsNullOrWhiteSpace($content)) { return $null }
        return $content | ConvertFrom-Json
    } catch { return $null }
}

$headers = @{
    "User-Agent"      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    "Accept"          = "application/json, text/plain, */*"
    "Accept-Language" = "en-US,en;q=0.9"
}

function Fetch-Ticker($ticker, [ref]$pricesData, [ref]$chainData) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Fetching $ticker..." -ForegroundColor White

    # ── Price ────────────────────────────────────────────────────────────────
    try {
        $priceUrl = "https://query1.finance.yahoo.com/v8/finance/chart/$ticker`?interval=1d&range=1d"
        $resp = Invoke-RestMethod -Uri $priceUrl -Headers $headers -TimeoutSec 15 -ErrorAction Stop
        $meta = $resp.chart.result[0].meta
        $price = [Math]::Round([double]$meta.regularMarketPrice, 2)
        $prevClose = [double]$meta.previousClose
        $changePct = 0
        if ($prevClose -gt 0) {
            $changePct = [Math]::Round((($price - $prevClose) / $prevClose) * 100, 2)
        }

        $priceEntry = [PSCustomObject]@{
            price      = $price
            change_pct = $changePct
            updated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        }

        if ($pricesData.Value -eq $null) {
            $pricesData.Value = New-Object PSObject
        }
        $pricesData.Value | Add-Member -MemberType NoteProperty -Name $ticker -Value $priceEntry -Force
        Write-Host "  Price: `$$price ($changePct%)" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] Price fetch failed for $ticker : $_" -ForegroundColor Yellow
    }

    Start-Sleep -Milliseconds 600

    # ── Options Chain ─────────────────────────────────────────────────────────
    try {
        $optUrl = "https://query1.finance.yahoo.com/v7/finance/options/$ticker"
        $optResp = Invoke-RestMethod -Uri $optUrl -Headers $headers -TimeoutSec 20 -ErrorAction Stop
        $optResult = $optResp.optionChain.result[0]

        if (-not $optResult) {
            Write-Host "  [WARN] No options data for $ticker" -ForegroundColor Yellow
            return
        }

        $expirations = $optResult.expirationDates
        $expsToProcess = if ($expirations.Count -gt 3) { $expirations[0..2] } else { $expirations }

        $optionsArr = @()

        foreach ($exp in $expsToProcess) {
            try {
                $expUrl = "https://query1.finance.yahoo.com/v7/finance/options/$ticker`?date=$exp"
                $expResp = Invoke-RestMethod -Uri $expUrl -Headers $headers -TimeoutSec 15 -ErrorAction Stop
                $expResult = $expResp.optionChain.result[0]
                if (-not $expResult) { continue }

                $expDate = [DateTimeOffset]::FromUnixTimeSeconds($exp).ToString("yyyy-MM-dd")

                foreach ($call in $expResult.options[0].calls) {
                    $optionsArr += [PSCustomObject]@{
                        strike        = if ($call.strike.raw) { [Math]::Round([double]$call.strike.raw, 2) } else { 0 }
                        expiry        = $expDate
                        call_put      = "CALL"
                        bid           = if ($call.bid.raw) { [Math]::Round([double]$call.bid.raw, 2) } else { 0 }
                        ask           = if ($call.ask.raw) { [Math]::Round([double]$call.ask.raw, 2) } else { 0 }
                        iv            = if ($call.impliedVolatility.raw) { [Math]::Round([double]$call.impliedVolatility.raw, 4) } else { 0 }
                        delta         = if ($call.delta) { [Math]::Round([double]$call.delta, 4) } else { $null }
                        theta         = if ($call.theta) { [Math]::Round([double]$call.theta, 4) } else { $null }
                        volume        = if ($call.volume.raw) { [int]$call.volume.raw } else { 0 }
                        open_interest = if ($call.openInterest.raw) { [int]$call.openInterest.raw } else { 0 }
                        fetched_at    = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
                    }
                }

                foreach ($put in $expResult.options[0].puts) {
                    $optionsArr += [PSCustomObject]@{
                        strike        = if ($put.strike.raw) { [Math]::Round([double]$put.strike.raw, 2) } else { 0 }
                        expiry        = $expDate
                        call_put      = "PUT"
                        bid           = if ($put.bid.raw) { [Math]::Round([double]$put.bid.raw, 2) } else { 0 }
                        ask           = if ($put.ask.raw) { [Math]::Round([double]$put.ask.raw, 2) } else { 0 }
                        iv            = if ($put.impliedVolatility.raw) { [Math]::Round([double]$put.impliedVolatility.raw, 4) } else { 0 }
                        delta         = if ($put.delta) { [Math]::Round([double]$put.delta, 4) } else { $null }
                        theta         = if ($put.theta) { [Math]::Round([double]$put.theta, 4) } else { $null }
                        volume        = if ($put.volume.raw) { [int]$put.volume.raw } else { 0 }
                        open_interest = if ($put.openInterest.raw) { [int]$put.openInterest.raw } else { 0 }
                        fetched_at    = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
                    }
                }

                Write-Host "  Expiry $expDate : $($optionsArr.Count) contracts so far" -ForegroundColor DarkGray
                Start-Sleep -Milliseconds 400
            } catch {
                Write-Host "  [WARN] Expiry $exp failed: $_" -ForegroundColor Yellow
            }
        }

        if ($optionsArr.Count -gt 0) {
            if ($chainData.Value -eq $null) {
                $chainData.Value = New-Object PSObject
            }
            $chainData.Value | Add-Member -MemberType NoteProperty -Name $ticker -Value $optionsArr -Force
            Write-Host "  Options: $($optionsArr.Count) contracts saved" -ForegroundColor Green
        }

    } catch {
        Write-Host "  [WARN] Options fetch failed for $ticker : $_" -ForegroundColor Yellow
    }
}

while ($true) {
    Write-Host ""
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting options fetch cycle..." -ForegroundColor Cyan

    $watchlist = Read-Watchlist
    if ($watchlist.Count -eq 0) {
        Write-Host "  Watchlist empty, skipping." -ForegroundColor Yellow
    } else {
        $pricesPath = Join-Path $DataDir "stock_prices.json"
        $chainPath  = Join-Path $DataDir "options_chain.json"

        $pricesObj = Load-Json $pricesPath
        $chainObj  = Load-Json $chainPath

        if ($pricesObj -eq $null) { $pricesObj = New-Object PSObject }
        if ($chainObj -eq $null)  { $chainObj  = New-Object PSObject }

        foreach ($item in $watchlist) {
            $ticker = $item.ticker
            if (-not $ticker) { continue }
            Fetch-Ticker $ticker ([ref]$pricesObj) ([ref]$chainObj)
            Start-Sleep -Milliseconds 1000
        }

        Save-Json $pricesPath $pricesObj
        Save-Json $chainPath  $chainObj
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Cycle complete. Next in 60s." -ForegroundColor Cyan
    }

    Start-Sleep -Seconds 60
}
