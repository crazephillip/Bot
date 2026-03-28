# Trading Platform - PowerShell HTTP Server
# Port 5000 | PowerShell 5.1 Compatible

$ErrorActionPreference = "SilentlyContinue"
$script:RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:DataDir = Join-Path $script:RootDir "data"
$script:TemplatesDir = Join-Path $script:RootDir "templates"
$script:StaticDir = Join-Path $script:RootDir "static"

# Ensure data directory exists
if (-not (Test-Path $script:DataDir)) { New-Item -ItemType Directory -Path $script:DataDir | Out-Null }

# ─── Helper Functions ────────────────────────────────────────────────────────

function Read-JsonData($file) {
    $path = Join-Path $script:DataDir "$file.json"
    if (-not (Test-Path $path)) { return @() }
    try {
        $content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($content)) { return @() }
        $parsed = $content | ConvertFrom-Json
        # PS 5.1: collect into array so items unroll normally through pipeline
        $list = New-Object System.Collections.ArrayList
        $parsed | ForEach-Object { [void]$list.Add($_) }
        return $list  # items unroll; @(Read-JsonData ...) gets individual items
    } catch {
        return @()
    }
}

function Write-JsonData($file, $data) {
    $path = Join-Path $script:DataDir "$file.json"
    try {
        $json = $data | ConvertTo-Json -Depth 10
        [System.IO.File]::WriteAllText($path, $json, [System.Text.Encoding]::UTF8)
        return $true
    } catch {
        return $false
    }
}

function Serve-File($res, $path, $contentType) {
    try {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $res.ContentType = $contentType
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        $res.StatusCode = 500
        $errBytes = [System.Text.Encoding]::UTF8.GetBytes("File read error: $_")
        $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
    }
}

function Send-Json($res, $data, $status) {
    if ($status -eq $null) { $status = 200 }
    try {
        # PS 5.1 bug: piping arrays to ConvertTo-Json wraps them as {"value":[...],"Count":N}
        # Fix: manually build JSON array string using foreach to enumerate items
        if ($data -is [System.Array] -or $data -is [System.Collections.IList]) {
            $jsonParts = New-Object System.Collections.Generic.List[string]
            foreach ($item in $data) {
                $jsonParts.Add((ConvertTo-Json -InputObject $item -Depth 9 -Compress))
            }
            $json = "[" + ($jsonParts -join ",") + "]"
        } else {
            $json = ConvertTo-Json -InputObject $data -Depth 10
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $res.StatusCode = $status
        $res.ContentType = "application/json; charset=utf-8"
        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } catch {
        Write-Host "Send-Json error: $_"
    }
}

function Get-RequestBody($req) {
    try {
        $reader = New-Object System.IO.StreamReader($req.InputStream, $req.ContentEncoding)
        $body = $reader.ReadToEnd()
        if ([string]::IsNullOrWhiteSpace($body)) { return $null }
        return $body | ConvertFrom-Json
    } catch {
        return $null
    }
}

function New-Guid-Simple() {
    return [System.Guid]::NewGuid().ToString()
}

function Get-ContentType($ext) {
    switch ($ext.ToLower()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".js"   { return "application/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".png"  { return "image/png" }
        ".ico"  { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

# ─── Options Screener Logic ───────────────────────────────────────────────────

function Get-ScreenerResults() {
    $chainData = Read-JsonData "options_chain"
    $priceData = Read-JsonData "stock_prices"
    $results = @()

    # chainData is PSCustomObject keyed by ticker
    $tickers = @()
    if ($chainData -and $chainData.PSObject.Properties) {
        $tickers = $chainData.PSObject.Properties.Name
    }

    foreach ($ticker in $tickers) {
        $chain = $chainData.$ticker
        if (-not $chain) { continue }

        $priceInfo = $null
        if ($priceData -and $priceData.PSObject.Properties[$ticker]) {
            $priceInfo = $priceData.$ticker
        }
        $currentPrice = 0
        if ($priceInfo -and $priceInfo.price) { $currentPrice = [double]$priceInfo.price }

        foreach ($opt in $chain) {
            $score = 0
            $flags = @()

            $vol = 0
            if ($opt.volume) { $vol = [int]$opt.volume }
            $oi = 0
            if ($opt.open_interest) { $oi = [int]$opt.open_interest }
            $iv = 0
            if ($opt.iv) { $iv = [double]$opt.iv }

            # Volume spike: vol > 2x OI or vol > 5000
            if ($oi -gt 0 -and $vol -gt ($oi * 2)) {
                $score += 30
                $flags += "Vol Spike"
            }
            if ($vol -gt 5000) {
                $score += 20
                $flags += "High Volume"
            }

            # High IV
            if ($iv -gt 0.50) {
                $score += 25
                $flags += "High IV"
            }

            # Near the money
            $strike = 0
            if ($opt.strike) { $strike = [double]$opt.strike }
            if ($currentPrice -gt 0 -and $strike -gt 0) {
                $pctFromMoney = [Math]::Abs($strike - $currentPrice) / $currentPrice
                if ($pctFromMoney -lt 0.03) {
                    $score += 20
                    $flags += "Near ATM"
                }
            }

            if ($score -ge 20) {
                $mid = 0
                if ($opt.bid -and $opt.ask) { $mid = ([double]$opt.bid + [double]$opt.ask) / 2 }
                $results += [PSCustomObject]@{
                    ticker        = $ticker
                    strike        = $opt.strike
                    expiry        = $opt.expiry
                    call_put      = $opt.call_put
                    bid           = $opt.bid
                    ask           = $opt.ask
                    mid           = [Math]::Round($mid, 2)
                    iv            = $opt.iv
                    delta         = $opt.delta
                    theta         = $opt.theta
                    volume        = $opt.volume
                    open_interest = $opt.open_interest
                    score         = $score
                    flags         = ($flags -join ", ")
                }
            }
        }
    }

    # Sort by score descending
    $results = $results | Sort-Object score -Descending
    return $results
}

# ─── NBA Prop Model ──────────────────────────────────────────────────────────

function Invoke-PropModel($playerId, $stat, $line, $homeAway) {
    $gamelogs = Read-JsonData "nba_gamelogs"
    if (-not $gamelogs) { return $null }

    $playerLogs = @($gamelogs | Where-Object { $_.player_id -eq $playerId })
    if ($playerLogs.Count -eq 0) { return $null }

    # Sort by date descending
    $sorted = $playerLogs | Sort-Object date -Descending

    function Get-StatValue($log, $statName) {
        switch ($statName) {
            "pts"     { return [double]$log.pts }
            "reb"     { return [double]$log.reb }
            "ast"     { return [double]$log.ast }
            "stl"     { return [double]$log.stl }
            "blk"     { return [double]$log.blk }
            "three_pm"{ return [double]$log.three_pm }
            default   { return [double]$log.pts }
        }
    }

    $last5  = @($sorted | Select-Object -First 5)
    $last10 = @($sorted | Select-Object -First 10)
    $allLogs = $sorted

    function Avg($logs) {
        if ($logs.Count -eq 0) { return 0 }
        $sum = 0
        foreach ($l in $logs) { $sum += Get-StatValue $l $stat }
        return $sum / $logs.Count
    }

    $last5avg   = Avg $last5
    $last10avg  = Avg $last10
    $seasonavg  = Avg $allLogs

    $homeAwayLogs = @($allLogs | Where-Object { $_.home_away -eq $homeAway })
    $homeawayavg = if ($homeAwayLogs.Count -gt 0) { Avg $homeAwayLogs } else { $seasonavg }

    # vs opponent - we don't know tonight's opponent here so use season avg
    $vsOpponent = $seasonavg

    # Opponent adjust placeholder (neutral = 0)
    $oppAdjust = $seasonavg

    $predicted = ($last5avg * 0.35) + ($last10avg * 0.20) + ($seasonavg * 0.15) `
               + ($homeawayavg * 0.10) + ($vsOpponent * 0.15) + ($oppAdjust * 0.05)

    # Standard deviation of last 10
    $stdDev = 3.0
    if ($last10.Count -ge 2) {
        $mean = $last10avg
        $sumSq = 0
        foreach ($l in $last10) {
            $v = Get-StatValue $l $stat
            $sumSq += ($v - $mean) * ($v - $mean)
        }
        $variance = $sumSq / $last10.Count
        $stdDev = [Math]::Sqrt($variance)
        if ($stdDev -lt 0.1) { $stdDev = 0.1 }
    }

    # Normal CDF approximation (Abramowitz & Stegun)
    function NormalCDF($z) {
        $t = 1.0 / (1.0 + 0.2316419 * [Math]::Abs($z))
        $poly = $t * (0.319381530 + $t * (-0.356563782 + $t * (1.781477937 + $t * (-1.821255978 + $t * 1.330274429))))
        $phi = (1.0 / [Math]::Sqrt(2 * [Math]::PI)) * [Math]::Exp(-0.5 * $z * $z)
        $cdf = 1.0 - $phi * $poly
        if ($z -lt 0) { $cdf = 1.0 - $cdf }
        return $cdf
    }

    $lineVal = [double]$line
    $zScore = ($lineVal - $predicted) / $stdDev
    $ourProbOver = 1 - (NormalCDF $zScore)

    $impliedProb = 0.524
    $ev = ($ourProbOver * 0.909) - ((1 - $ourProbOver) * 1.0)

    $confidence = "C"
    if ([Math]::Abs($ev) -gt 0.10) { $confidence = "A" }
    elseif ([Math]::Abs($ev) -gt 0.07) { $confidence = "B" }

    # Kelly criterion
    $b = 0.909
    $p = $ourProbOver
    $q = 1 - $p
    $kelly = 0
    if ($b -gt 0) { $kelly = ($b * $p - $q) / $b }
    if ($kelly -lt 0) { $kelly = 0 }
    $kellyHalf = $kelly * 0.5

    $last5vals = @()
    foreach ($l in $last5) { $last5vals += Get-StatValue $l $stat }

    return [PSCustomObject]@{
        predicted    = [Math]::Round($predicted, 2)
        last5avg     = [Math]::Round($last5avg, 2)
        last10avg    = [Math]::Round($last10avg, 2)
        seasonavg    = [Math]::Round($seasonavg, 2)
        homeawayavg  = [Math]::Round($homeawayavg, 2)
        std_dev      = [Math]::Round($stdDev, 2)
        z_score      = [Math]::Round($zScore, 3)
        our_prob     = [Math]::Round($ourProbOver, 4)
        implied_prob = $impliedProb
        ev           = [Math]::Round($ev, 4)
        confidence   = $confidence
        kelly        = [Math]::Round($kelly, 4)
        kelly_half   = [Math]::Round($kellyHalf, 4)
        last5        = $last5vals
        games_used   = $allLogs.Count
    }
}

# ─── Background Data Fetcher (Runspace) ──────────────────────────────────────

function Start-BackgroundFetcher() {
    $iss = [System.Management.Automation.Runspaces.InitialSessionState]::CreateDefault()
    $runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace($iss)
    $runspace.Open()

    $runspace.SessionStateProxy.SetVariable("DataDir", $script:DataDir)

    $ps = [System.Management.Automation.PowerShell]::Create()
    $ps.Runspace = $runspace

    $script = {
        param($DataDir)

        function FetchAndSave() {
            $watchlistPath = Join-Path $DataDir "watchlist.json"
            if (-not (Test-Path $watchlistPath)) { return }

            try {
                $watchlist = Get-Content $watchlistPath -Raw | ConvertFrom-Json
            } catch { return }

            $pricesPath  = Join-Path $DataDir "stock_prices.json"
            $chainPath   = Join-Path $DataDir "options_chain.json"

            $pricesData = @{}
            if (Test-Path $pricesPath) {
                try { $pricesData = Get-Content $pricesPath -Raw | ConvertFrom-Json } catch {}
            }

            $chainData = @{}
            if (Test-Path $chainPath) {
                try { $chainData = Get-Content $chainPath -Raw | ConvertFrom-Json } catch {}
            }

            $headers = @{
                "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }

            foreach ($item in $watchlist) {
                $ticker = $item.ticker
                if (-not $ticker) { continue }

                try {
                    # Fetch price
                    $priceUrl = "https://query1.finance.yahoo.com/v8/finance/chart/$ticker`?interval=1d&range=1d"
                    $priceResp = Invoke-RestMethod -Uri $priceUrl -Headers $headers -TimeoutSec 15 -ErrorAction Stop
                    $meta = $priceResp.chart.result[0].meta
                    $price = [Math]::Round([double]$meta.regularMarketPrice, 2)
                    $prevClose = [double]$meta.previousClose
                    $changePct = 0
                    if ($prevClose -gt 0) {
                        $changePct = [Math]::Round((($price - $prevClose) / $prevClose) * 100, 2)
                    }
                    $pricesData | Add-Member -MemberType NoteProperty -Name $ticker -Value @{
                        price      = $price
                        change_pct = $changePct
                        updated_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
                    } -Force
                } catch {
                    # Keep existing price data on failure
                }

                Start-Sleep -Milliseconds 500

                try {
                    # Fetch options chain
                    $optUrl = "https://query1.finance.yahoo.com/v7/finance/options/$ticker"
                    $optResp = Invoke-RestMethod -Uri $optUrl -Headers $headers -TimeoutSec 20 -ErrorAction Stop
                    $optResult = $optResp.optionChain.result[0]
                    if (-not $optResult) { continue }

                    $optionsArr = @()
                    $expirations = $optResult.expirationDates

                    # Process first 3 expirations only for performance
                    $expsToProcess = if ($expirations.Count -gt 3) { $expirations[0..2] } else { $expirations }

                    foreach ($exp in $expsToProcess) {
                        try {
                            $expUrl = "https://query1.finance.yahoo.com/v7/finance/options/$ticker`?date=$exp"
                            $expResp = Invoke-RestMethod -Uri $expUrl -Headers $headers -TimeoutSec 15 -ErrorAction Stop
                            $expResult = $expResp.optionChain.result[0]
                            if (-not $expResult) { continue }

                            $expDate = [DateTimeOffset]::FromUnixTimeSeconds($exp).ToString("yyyy-MM-dd")

                            foreach ($call in $expResult.options[0].calls) {
                                $optionsArr += [PSCustomObject]@{
                                    strike        = [Math]::Round([double]$call.strike.raw, 2)
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
                                    strike        = [Math]::Round([double]$put.strike.raw, 2)
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

                            Start-Sleep -Milliseconds 300
                        } catch {}
                    }

                    if ($optionsArr.Count -gt 0) {
                        $chainData | Add-Member -MemberType NoteProperty -Name $ticker -Value $optionsArr -Force
                    }
                } catch {}

                Start-Sleep -Milliseconds 800
            }

            # Save updated data
            try {
                $pricesData | ConvertTo-Json -Depth 5 | Set-Content -Path $pricesPath -Encoding UTF8
            } catch {}
            try {
                $chainData | ConvertTo-Json -Depth 10 | Set-Content -Path $chainPath -Encoding UTF8
            } catch {}
        }

        while ($true) {
            try { FetchAndSave } catch {}
            Start-Sleep -Seconds 60
        }
    }

    $null = $ps.AddScript($script).AddArgument($script:DataDir)
    $null = $ps.BeginInvoke()
    Write-Host "[BG] Options fetcher runspace started." -ForegroundColor Cyan
}

# ─── Request Router ──────────────────────────────────────────────────────────

function Handle-Request($ctx) {
    $req = $ctx.Request
    $res = $ctx.Response
    $url = $req.Url.AbsolutePath.TrimEnd('/')
    $method = $req.HttpMethod

    # CORS preflight
    if ($method -eq "OPTIONS") {
        $res.Headers.Add("Access-Control-Allow-Origin", "*")
        $res.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        $res.Headers.Add("Access-Control-Allow-Headers", "Content-Type")
        $res.StatusCode = 204
        $res.Close()
        return
    }

    try {
        # Root redirect
        if ($url -eq "" -or $url -eq "/") {
            $res.Redirect("http://localhost:5000/options")
            $res.Close()
            return
        }

        # Static files
        if ($url.StartsWith("/static/")) {
            $filePath = Join-Path $script:StaticDir ($url.Substring(8).Replace("/", "\"))
            if (Test-Path $filePath) {
                $ext = [System.IO.Path]::GetExtension($filePath)
                Serve-File $res $filePath (Get-ContentType $ext)
            } else {
                $res.StatusCode = 404
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $url")
                $res.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            $res.Close()
            return
        }

        # HTML pages
        if ($url -eq "/options") {
            Serve-File $res (Join-Path $script:TemplatesDir "index.html") "text/html; charset=utf-8"
            $res.Close()
            return
        }
        if ($url -eq "/nba") {
            Serve-File $res (Join-Path $script:TemplatesDir "nba.html") "text/html; charset=utf-8"
            $res.Close()
            return
        }

        # ── Options API ──────────────────────────────────────────────────────

        if ($url -eq "/api/watchlist" -and $method -eq "GET") {
            $data = Read-JsonData "watchlist"
            Send-Json $res $data
            $res.Close()
            return
        }

        if ($url -eq "/api/watchlist/add" -and $method -eq "POST") {
            $body = Get-RequestBody $req
            if (-not $body -or -not $body.ticker) {
                Send-Json $res @{error="ticker required"} 400
                $res.Close()
                return
            }
            $ticker = $body.ticker.ToUpper().Trim()
            $watchlist = @(Read-JsonData "watchlist")
            $exists = $watchlist | Where-Object { $_.ticker -eq $ticker }
            if ($exists) {
                Send-Json $res @{ok=$true; message="already in watchlist"}
                $res.Close()
                return
            }
            $watchlist += [PSCustomObject]@{
                ticker   = $ticker
                added_on = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
            }
            Write-JsonData "watchlist" $watchlist
            Send-Json $res @{ok=$true; ticker=$ticker}
            $res.Close()
            return
        }

        if ($url.StartsWith("/api/watchlist/") -and $method -eq "DELETE") {
            $ticker = $url.Substring(15).ToUpper().Trim()
            $watchlist = @(Read-JsonData "watchlist")
            $updated = @($watchlist | Where-Object { $_.ticker -ne $ticker })
            Write-JsonData "watchlist" $updated
            Send-Json $res @{ok=$true; removed=$ticker}
            $res.Close()
            return
        }

        if ($url.StartsWith("/api/options/") -and $method -eq "GET") {
            $ticker = $url.Substring(13).ToUpper().Trim()
            $chainData = Read-JsonData "options_chain"
            $chain = $null
            if ($chainData -and $chainData.PSObject.Properties[$ticker]) {
                $chain = $chainData.$ticker
            }
            if (-not $chain) { $chain = @() }
            Send-Json $res $chain
            $res.Close()
            return
        }

        if ($url.StartsWith("/api/price/") -and $method -eq "GET") {
            $ticker = $url.Substring(11).ToUpper().Trim()
            $priceData = Read-JsonData "stock_prices"
            $price = $null
            if ($priceData -and $priceData.PSObject.Properties[$ticker]) {
                $price = $priceData.$ticker
            }
            if ($price) {
                Send-Json $res $price
            } else {
                Send-Json $res @{error="no price data"} 404
            }
            $res.Close()
            return
        }

        if ($url -eq "/api/trades" -and $method -eq "GET") {
            $trades = Read-JsonData "my_trades"
            Send-Json $res $trades
            $res.Close()
            return
        }

        if ($url -eq "/api/trades/add" -and $method -eq "POST") {
            $body = Get-RequestBody $req
            if (-not $body) {
                Send-Json $res @{error="invalid body"} 400
                $res.Close()
                return
            }
            $trades = @(Read-JsonData "my_trades")
            $newTrade = [PSCustomObject]@{
                id            = "trade-" + (New-Guid-Simple).Substring(0,8)
                ticker        = if ($body.ticker) { $body.ticker.ToUpper() } else { "" }
                strike        = if ($body.strike) { [double]$body.strike } else { 0 }
                expiry        = if ($body.expiry) { $body.expiry } else { "" }
                call_put      = if ($body.call_put) { $body.call_put.ToUpper() } else { "CALL" }
                contracts     = if ($body.contracts) { [int]$body.contracts } else { 1 }
                entry_price   = if ($body.entry_price) { [double]$body.entry_price } else { 0 }
                current_price = if ($body.entry_price) { [double]$body.entry_price } else { 0 }
                status        = "open"
                opened_at     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
                closed_at     = $null
                notes         = if ($body.notes) { $body.notes } else { "" }
                pnl           = 0
            }
            $trades += $newTrade
            Write-JsonData "my_trades" $trades
            Send-Json $res $newTrade
            $res.Close()
            return
        }

        if ($url -match "^/api/trades/(.+)/close$" -and $method -eq "PUT") {
            $tradeId = $Matches[1]
            $body = Get-RequestBody $req
            $trades = @(Read-JsonData "my_trades")
            $updated = @()
            $found = $false
            foreach ($t in $trades) {
                if ($t.id -eq $tradeId) {
                    $closePrice = if ($body -and $body.close_price) { [double]$body.close_price } else { [double]$t.current_price }
                    $contracts = if ($t.contracts) { [int]$t.contracts } else { 1 }
                    $entryPrice = if ($t.entry_price) { [double]$t.entry_price } else { 0 }
                    $pnl = ($closePrice - $entryPrice) * $contracts * 100
                    $t.status        = "closed"
                    $t.current_price = $closePrice
                    $t.closed_at     = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
                    $t.pnl           = [Math]::Round($pnl, 2)
                    $found = $true
                }
                $updated += $t
            }
            if (-not $found) {
                Send-Json $res @{error="trade not found"} 404
                $res.Close()
                return
            }
            Write-JsonData "my_trades" $updated
            Send-Json $res @{ok=$true}
            $res.Close()
            return
        }

        if ($url -eq "/api/screener" -and $method -eq "GET") {
            $results = Get-ScreenerResults
            Send-Json $res $results
            $res.Close()
            return
        }

        # ── NBA API ──────────────────────────────────────────────────────────

        if ($url -eq "/api/nba/picks/today" -and $method -eq "GET") {
            $today = Get-Date -Format "yyyy-MM-dd"
            $picks = @(Read-JsonData "nba_picks")
            $todayPicks = @($picks | Where-Object { $_.date -eq $today })
            if ($todayPicks.Count -eq 0) { $todayPicks = $picks }  # fallback: show all
            Send-Json $res $todayPicks
            $res.Close()
            return
        }

        # Real matchup data from live game logs
        if ($url -eq "/api/nba/matchups" -and $method -eq "GET") {
            $todayGames  = @(Read-JsonData "nba_today_games")
            $gamelogs    = @(Read-JsonData "nba_gamelogs")
            $players     = @(Read-JsonData "nba_players")

            # Build per-team defensive averages: pts/reb/ast allowed to opponents
            $teamDef = @{}
            $teamOff = @{}
            foreach ($log in $gamelogs) {
                $opp = [string]$log.opponent
                $tm  = [string]$log.team
                if (-not $opp -or -not $tm) { continue }
                $dPts = 0.0; $dReb = 0.0; $dAst = 0.0
                try { $dPts = [double]$log.pts } catch {}
                try { $dReb = [double]$log.reb } catch {}
                try { $dAst = [double]$log.ast } catch {}
                if (-not $teamDef[$opp]) { $teamDef[$opp] = @{pts=New-Object System.Collections.ArrayList;reb=New-Object System.Collections.ArrayList;ast=New-Object System.Collections.ArrayList} }
                [void]$teamDef[$opp]["pts"].Add($dPts)
                [void]$teamDef[$opp]["reb"].Add($dReb)
                [void]$teamDef[$opp]["ast"].Add($dAst)
            }

            $matchups = @()
            foreach ($g in $todayGames) {
                $homePlayers = @($players | Where-Object { $_.team -eq $g.home })
                $awayPlayers = @($players | Where-Object { $_.team -eq $g.away })

                # Inline def avg calculation (no nested function — PS scoping issues)
                $hDefPts = $null; $hDefReb = $null; $hDefAst = $null
                $aDefPts = $null; $aDefReb = $null; $aDefAst = $null
                if ($teamDef[$g.home]) {
                    $arr = @($teamDef[$g.home]["pts"]); if ($arr.Count -gt 0) { $hDefPts = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                    $arr = @($teamDef[$g.home]["reb"]); if ($arr.Count -gt 0) { $hDefReb = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                    $arr = @($teamDef[$g.home]["ast"]); if ($arr.Count -gt 0) { $hDefAst = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                }
                if ($teamDef[$g.away]) {
                    $arr = @($teamDef[$g.away]["pts"]); if ($arr.Count -gt 0) { $aDefPts = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                    $arr = @($teamDef[$g.away]["reb"]); if ($arr.Count -gt 0) { $aDefReb = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                    $arr = @($teamDef[$g.away]["ast"]); if ($arr.Count -gt 0) { $aDefAst = [Math]::Round(($arr | Measure-Object -Sum).Sum / $arr.Count, 1) }
                }

                # Flag players with favorable matchup history vs opponent
                $flags = @()
                foreach ($p in ($homePlayers + $awayPlayers)) {
                    $matchPid = [string]$p.id
                    $pOpp  = if ($homePlayers -contains $p) { $g.away } else { $g.home }
                    $pLogs = @($gamelogs | Where-Object { $_.player_id -eq $matchPid } | Sort-Object date -Descending | Select-Object -First 10)
                    if ($pLogs.Count -lt 3) { continue }
                    $ptsVals = New-Object System.Collections.ArrayList
                    foreach ($lg in $pLogs) { $v = 0.0; try { $v = [double]$lg.pts } catch {}; [void]$ptsVals.Add($v) }
                    $avgPts  = [Math]::Round(($ptsVals | Measure-Object -Sum).Sum / $ptsVals.Count, 1)
                    $vsOppLogs = @($gamelogs | Where-Object { $_.player_id -eq $matchPid -and $_.opponent -eq $pOpp })
                    $grade = "C"
                    if ($vsOppLogs.Count -ge 2) {
                        $vsVals = New-Object System.Collections.ArrayList
                        foreach ($lg in $vsOppLogs) { $v = 0.0; try { $v = [double]$lg.pts } catch {}; [void]$vsVals.Add($v) }
                        $vsAvg  = ($vsVals | Measure-Object -Sum).Sum / $vsVals.Count
                        if ($vsAvg -gt $avgPts * 1.10) { $grade = "A" }
                        elseif ($vsAvg -gt $avgPts * 1.03) { $grade = "B" }
                    }
                    $flags += [pscustomobject]@{
                        player  = [string]$p.name
                        team    = [string]$p.team
                        opp     = $pOpp
                        avg_pts = $avgPts
                        grade   = $grade
                    }
                }

                $matchups += [pscustomobject]@{
                    game         = "$($g.away) @ $($g.home)"
                    home         = [string]$g.home
                    away         = [string]$g.away
                    time         = [string]$g.time
                    status       = [string]$g.status
                    home_def_pts = $hDefPts
                    home_def_reb = $hDefReb
                    home_def_ast = $hDefAst
                    away_def_pts = $aDefPts
                    away_def_reb = $aDefReb
                    away_def_ast = $aDefAst
                    players      = $flags
                }
            }
            Send-Json $res $matchups
            $res.Close()
            return
        }

        if ($url.StartsWith("/api/nba/players") -and $method -eq "GET") {
            $search = $req.QueryString["search"]
            $players = @(Read-JsonData "nba_players")
            if ($search -and $search.Length -gt 0) {
                $players = @($players | Where-Object { $_.name -match [regex]::Escape($search) })
            }
            Send-Json $res $players
            $res.Close()
            return
        }

        if ($url -match "^/api/nba/player/(.+)/stats$" -and $method -eq "GET") {
            $playerRouteId = $Matches[1]
            $gamelogs = @(Read-JsonData "nba_gamelogs")
            $playerLogs = @($gamelogs | Where-Object { $_.player_id -eq $playerRouteId } | Sort-Object date -Descending)
            Send-Json $res $playerLogs
            $res.Close()
            return
        }

        if ($url -match "^/api/nba/player/(.+)/props$" -and $method -eq "GET") {
            $playerRouteId = $Matches[1]
            $line     = $req.QueryString["line"]
            $stat     = $req.QueryString["stat"]
            $homeAway = $req.QueryString["home_away"]
            if (-not $stat)     { $stat     = "pts" }
            if (-not $line)     { $line     = "20.5" }
            if (-not $homeAway) { $homeAway = "home" }
            $result = Invoke-PropModel $playerRouteId $stat ([double]$line) $homeAway
            if ($result) {
                Send-Json $res $result
            } else {
                Send-Json $res @{error="not enough data for player $playerRouteId"} 404
            }
            $res.Close()
            return
        }

        if ($url -eq "/api/nba/bets" -and $method -eq "GET") {
            $bets = Read-JsonData "nba_bets"
            Send-Json $res $bets
            $res.Close()
            return
        }

        if ($url -eq "/api/nba/bets/add" -and $method -eq "POST") {
            $body = Get-RequestBody $req
            if (-not $body) {
                Send-Json $res @{error="invalid body"} 400
                $res.Close()
                return
            }
            $bets = @(Read-JsonData "nba_bets")
            $newBet = [PSCustomObject]@{
                id          = "bet-" + (New-Guid-Simple).Substring(0,8)
                date        = if ($body.date) { $body.date } else { (Get-Date -Format "yyyy-MM-dd") }
                player_name = if ($body.player_name) { $body.player_name } else { "" }
                prop_type   = if ($body.prop_type) { $body.prop_type } else { "pts" }
                line        = if ($body.line) { [double]$body.line } else { 0 }
                odds        = if ($body.odds) { [int]$body.odds } else { -110 }
                stake       = if ($body.stake) { [double]$body.stake } else { 0 }
                sportsbook  = if ($body.sportsbook) { $body.sportsbook } else { "" }
                result      = "pending"
                pnl         = 0
            }
            $bets += $newBet
            Write-JsonData "nba_bets" $bets
            Send-Json $res $newBet
            $res.Close()
            return
        }

        if ($url -match "^/api/nba/bets/(.+)/result$" -and $method -eq "PUT") {
            $betId = $Matches[1]
            $body = Get-RequestBody $req
            $bets = @(Read-JsonData "nba_bets")
            $updated = @()
            $found = $false
            foreach ($b in $bets) {
                if ($b.id -eq $betId) {
                    $result = if ($body -and $body.result) { $body.result } else { "pending" }
                    $b.result = $result
                    $stake = if ($b.stake) { [double]$b.stake } else { 0 }
                    $odds  = if ($b.odds) { [int]$b.odds } else { -110 }
                    if ($result -eq "win") {
                        if ($odds -lt 0) {
                            $b.pnl = [Math]::Round($stake * (100 / [Math]::Abs($odds)), 2)
                        } else {
                            $b.pnl = [Math]::Round($stake * ($odds / 100), 2)
                        }
                    } elseif ($result -eq "loss") {
                        $b.pnl = -$stake
                    } else {
                        $b.pnl = 0
                    }
                    $found = $true
                }
                $updated += $b
            }
            if (-not $found) {
                Send-Json $res @{error="bet not found"} 404
                $res.Close()
                return
            }
            Write-JsonData "nba_bets" $updated
            Send-Json $res @{ok=$true}
            $res.Close()
            return
        }

        # 404
        Send-Json $res @{error="Not found"; path=$url} 404
        $res.Close()

    } catch {
        Write-Host "Handler error: $_" -ForegroundColor Red
        try {
            Send-Json $res @{error="Internal server error"; detail=$_.ToString()} 500
            $res.Close()
        } catch {}
    }
}

# ─── Main Server Loop ─────────────────────────────────────────────────────────

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   Trading Platform Server v1.0" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Options:  http://localhost:5000/options" -ForegroundColor Green
Write-Host "  NBA:      http://localhost:5000/nba" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

Start-BackgroundFetcher

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:5000/")
$listener.Start()
Write-Host "[SERVER] Listening on http://localhost:5000/" -ForegroundColor Yellow
Write-Host "[SERVER] Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

try {
    while ($listener.IsListening) {
        try {
            $ctx = $listener.GetContext()
            $method = $ctx.Request.HttpMethod
            $path   = $ctx.Request.Url.AbsolutePath
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $method $path" -ForegroundColor Gray
            Handle-Request $ctx
        } catch {
            if ($listener.IsListening) {
                Write-Host "[ERROR] $_" -ForegroundColor Red
            }
        }
    }
} finally {
    $listener.Stop()
    Write-Host "[SERVER] Stopped." -ForegroundColor Yellow
}
