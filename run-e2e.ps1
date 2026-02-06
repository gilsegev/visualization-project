$serverProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start" -PassThru -NoNewWindow
Write-Host "⏳ Server started (PID: $($serverProcess.Id)). Waiting for port 3000..."

$url = "http://localhost:3000"
$maxRetries = 30
$retryDelay = 2

for ($i = 0; $i -lt $maxRetries; $i++) {
    try {
        $response = Invoke-WebRequest -Uri $url -Method Head -ErrorAction Stop
        if ($response.StatusCode -eq 200 -or $response.StatusCode -eq 404) {
            Write-Host "✅ Server is up!"
            break
        }
    }
    catch {
        # Port might be open but returning 404 or other error, which is fine, server is listening.
        # But Invoke-WebRequest throws on 4xx/5xx by default? No, Head should be fast.
        # Actually checking TCP port is safer.
    }
    
    # Check TCP Port
    $tcp = Test-NetConnection -ComputerName localhost -Port 3000 -InformationLevel Quiet
    if ($tcp) {
        Write-Host "✅ Port 3000 is listening!"
        break
    }

    Write-Host "Checking... ($($i+1)/$maxRetries)"
    Start-Sleep -Seconds $retryDelay
}

if ($tcp) {
    Write-Host "🚀 Running Test Script..."
    npx ts-node test-buying-funding-businesses.ts
}
else {
    Write-Host "❌ Server failed to start within timeout."
}

# Cleanup? 
# If we kill the server, we leave the user without a running server. 
# The user's original state had "test-tech-startup.ts" open, implying dev work.
# I should probably leave the server running if it started successfully.
# But `Start-Process` detaches. 
Write-Host "🏁 Done."
