param([string]$TaskName = 'try-comercial-diario')
$ErrorActionPreference = 'Stop'
$repository = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
$runner = Join-Path $repository 'scripts\run-typescript.cjs'
$daily = Join-Path $repository 'scripts\prospect-daily.ts'
$action = New-ScheduledTaskAction -Execute $nodeExecutable -Argument ('"{0}" "{1}"' -f $runner, $daily) -WorkingDirectory $repository
$trigger = New-ScheduledTaskTrigger -Daily -At '06:30'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Rastreo comercial diario a las 06:30 (hora local de Windows)' -Force
