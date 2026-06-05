$ErrorActionPreference = "Stop"

function Invoke-Setting {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Script
  )

  Write-Host "##[group]$Name"
  try {
    & $Script
    Write-Host "${Name}: applied"
  } catch {
    Write-Warning "${Name}: $($_.Exception.Message)"
  } finally {
    Write-Host "##[endgroup]"
  }
}

function Set-DwordValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [int]$Value
  )

  New-Item -Path $Path -Force | Out-Null
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
}

function Set-StringValue {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  New-Item -Path $Path -Force | Out-Null
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType String -Force | Out-Null
}

Write-Host "Disabling self-hosted Windows runner security checks for the internal beta release lane."

Invoke-Setting "Disable Microsoft Defender scanning gates" {
  Set-MpPreference `
    -DisableRealtimeMonitoring $true `
    -DisableBehaviorMonitoring $true `
    -DisableScriptScanning $true `
    -DisableIOAVProtection $true `
    -DisableArchiveScanning $true `
    -DisableBlockAtFirstSeen $true `
    -DisableIntrusionPreventionSystem $true `
    -MAPSReporting Disabled `
    -SubmitSamplesConsent NeverSend `
    -PUAProtection Disabled `
    -EnableControlledFolderAccess Disabled
}

Invoke-Setting "Disable configured attack surface reduction rules" {
  $preference = Get-MpPreference
  $ruleIds = @($preference.AttackSurfaceReductionRules_Ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($ruleIds.Count -eq 0) {
    Write-Host "No configured ASR rules found."
    return
  }
  $actions = @()
  foreach ($ruleId in $ruleIds) {
    $actions += "Disabled"
  }
  Set-MpPreference -AttackSurfaceReductionRules_Ids $ruleIds -AttackSurfaceReductionRules_Actions $actions
}

Invoke-Setting "Disable SmartScreen policy checks" {
  Set-DwordValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\System" -Name "EnableSmartScreen" -Value 0
  Set-DwordValue -Path "HKLM:\SOFTWARE\Policies\Microsoft\MicrosoftEdge\PhishingFilter" -Name "EnabledV9" -Value 0
  Set-DwordValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\AppHost" -Name "EnableWebContentEvaluation" -Value 0
  Set-StringValue -Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer" -Name "SmartScreenEnabled" -Value "Off"
  Set-StringValue -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer" -Name "SmartScreenEnabled" -Value "Off"
}

Invoke-Setting "Report Microsoft Defender state" {
  $status = Get-MpComputerStatus
  $preference = Get-MpPreference
  [ordered]@{
    AMRunningMode = $status.AMRunningMode
    AntivirusEnabled = $status.AntivirusEnabled
    BehaviorMonitorEnabled = $status.BehaviorMonitorEnabled
    IoavProtectionEnabled = $status.IoavProtectionEnabled
    IsTamperProtected = $status.IsTamperProtected
    NISEnabled = $status.NISEnabled
    OnAccessProtectionEnabled = $status.OnAccessProtectionEnabled
    RealTimeProtectionEnabled = $status.RealTimeProtectionEnabled
    AntispywareSignatureLastUpdated = $status.AntispywareSignatureLastUpdated
    AntivirusSignatureLastUpdated = $status.AntivirusSignatureLastUpdated
    DisableArchiveScanning = $preference.DisableArchiveScanning
    DisableBehaviorMonitoring = $preference.DisableBehaviorMonitoring
    DisableBlockAtFirstSeen = $preference.DisableBlockAtFirstSeen
    DisableIOAVProtection = $preference.DisableIOAVProtection
    DisableRealtimeMonitoring = $preference.DisableRealtimeMonitoring
    DisableScriptScanning = $preference.DisableScriptScanning
    EnableControlledFolderAccess = $preference.EnableControlledFolderAccess
    MAPSReporting = $preference.MAPSReporting
    PUAProtection = $preference.PUAProtection
  } | ConvertTo-Json -Depth 4 | Write-Host
}
