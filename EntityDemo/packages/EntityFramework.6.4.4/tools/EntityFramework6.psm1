# Copyright (c) Microsoft Corporation.  All rights reserved.

$ErrorActionPreference = 'Stop'
$InitialDatabase = '0'

<#
.SYNOPSIS
    Adds or updates an Entity Framework provider entry in the project config
    file.

.DESCRIPTION
    Adds an entry into the 'entityFramework' section of the project config
    file for the specified provider invariant name and provider type. If an
    entry for the given invariant name already exists, then that entry is
    updated with the given type name, unless the given type name already
    matches, in which case no action is taken. The 'entityFramework'
    section is added if it does not exist. The config file is automatically
    saved if and only if a change was made.

    This command is typically used only by Entity Framework provider NuGet
    packages and is run from the 'install.ps1' script.

.PARAMETER Project
    The Visual Studio project to update. When running in the NuGet install.ps1
    script the '$project' variable provided as part of that script should be
    used.

.PARAMETER InvariantName
    The provider invariant name that uniquely identifies this provider. For
    example, the Microsoft SQL Server provider is registered with the invariant
    name 'System.Data.SqlClient'.

.PARAMETER TypeName
    The assembly-qualified type name of the provider-specific type that
    inherits from 'System.Data.Entity.Core.Common.DbProviderServices'. For
    example, for the Microsoft SQL Server provider, this type is
    'System.Data.Entity.SqlServer.SqlProviderServices, EntityFramework.SqlServer'.
#>
function Add-EFProvider
{
    [CmdletBinding(PositionalBinding = $false)]
    param(
        [parameter(Position = 0, Mandatory = $true)]
        $Project,
        [parameter(Position = 1, Mandatory = $true)]
        [string] $InvariantName,
        [parameter(Position = 2, Mandatory = $true)]
        [string] $TypeName)

    $configPath = GetConfigPath $Project
    if (!$configPath)
    {
        return
    }

    [xml] $configXml = Get-Content $configPath

    $providers = $configXml.configuration.entityFramework.providers

    $providers.provider |
        where invariantName -eq $InvariantName |
        %{ $providers.RemoveChild($_) | Out-Null }

    $provider = $providers.AppendChild($configXml.CreateElement('provider'))
    $provider.SetAttribute('invariantName', $InvariantName)
    $provider.SetAttribute('type', $TypeName)

    $configXml.Save($configPath)
}

<#
.SYNOPSIS
    Adds or updates an Entity Framework default connection factory in the
    project config file.

.DESCRIPTION
    Adds an entry into the 'entityFramework' section of the project config
    file for the connection factory that Entity Framework will use by default
    when creating new connections by convention. Any existing entry will be
    overridden if it does not match. The 'entityFramework' section is added if
    it does not exist. The config file is automatically saved if and only if
    a change was made.

    This command is typically used only by Entity Framework provider NuGet
    packages and is run from the 'install.ps1' script.

.PARAMETER Project
    The Visual Studio project to update. When running in the NuGet install.ps1
    script the '$project' variable provided as part of that script should be
    used.

.PARAMETER TypeName
    The assembly-qualified type name of the connection factory type that
    implements the 'System.Data.Entity.Infrastructure.IDbConnectionFactory'
    interface.  For example, for the Microsoft SQL Server Express provider
    connection factory, this type is
    'System.Data.Entity.Infrastructure.SqlConnectionFactory, EntityFramework'.

.PARAMETER ConstructorArguments
    An optional array of strings that will be passed as arguments to the
    connection factory type constructor.
#>
function Add-EFDefaultConnectionFactory
{
    [CmdletBinding(PositionalBinding = $false)]
    param(
        [parameter(Position = 0, Mandatory = $true)]
        $Project,
        [parameter(Position = 1, Mandatory = $true)]
        [string] $TypeName,
        [string[]] $ConstructorArguments)

    $configPath = GetConfigPath $Project
    if (!$configPath)
    {
        return
    }

    [xml] $configXml = Get-Content $configPath

    $entityFramework = $configXml.configuration.entityFramework
    $defaultConnectionFactory = $entityFramework.defaultConnectionFactory
    if ($defaultConnectionFactory)
    {
        $entityFramework.RemoveChild($defaultConnectionFactory) | Out-Null
    }
    $defaultConnectionFactory = $entityFramework.AppendChild($configXml.CreateElement('defaultConnectionFactory'))

    $defaultConnectionFactory.SetAttribute('type', $TypeName)

    if ($ConstructorArguments)
    {
        $parameters = $defaultConnectionFactory.AppendChild($configXml.CreateElement('parameters'))

        foreach ($constructorArgument in $ConstructorArguments)
        {
            $parameter = $parameters.AppendChild($configXml.CreateElement('parameter'))
            $parameter.SetAttribute('value', $constructorArgument)
        }
    }

    $configXml.Save($configPath)
}

<#
.SYNOPSIS
    Enables Code First Migrations in a project.

.DESCRIPTION
    Enables Migrations by scaffolding a migrations configuration class in the project. If the
    target database was created by an initializer, an initial migration will be created (unless
    automatic migrations are enabled via the EnableAutomaticMigrations parameter).

.PARAMETER ContextTypeName
    Specifies the context to use. If omitted, migrations will attempt to locate a
    single context type in the target project.

.PARAMETER EnableAutomaticMigrations
    Specifies whether automatic migrations will be enabled in the scaffolded migrations configuration.
    If omitted, automatic migrations will be disabled.

.PARAMETER MigrationsDirectory
    Specifies the name of the directory that will contain migrations code files.
    If omitted, the directory will be named "Migrations".

.PARAMETER ProjectName
    Specifies the project that the scaffolded migrations configuration class will
    be added to. If omitted, the default project selected in package manager
    console is used.

.PARAMETER StartUpProjectName
    Specifies the configuration file to use for named connection strings. If
    omitted, the specified project's configuration file is used.

.PARAMETER ContextProjectName
    Specifies the project which contains the DbContext class to use. If omitted,
    the context is assumed to be in the same project used for migrations.

.PARAMETER ConnectionStringName
    Specifies the name of a connection string to use from the application's
    configuration file.

.PARAMETER ConnectionString
    Specifies the connection string to use. If omitted, the context's
    default connection will be used.

.PARAMETER ConnectionProviderName
    Specifies the provider invariant name of the connection string.

.PARAMETER Force
    Specifies that the migrations configuration be overwritten when running more
    than once for a given project.

.PARAMETER ContextAssemblyName
    Specifies the name of the assembly which contains the DbContext class to use. Use this
    parameter instead of ContextProjectName when the context is contained in a referenced
    assembly rather than in a project of the solution.

.PARAMETER AppDomainBaseDirectory
    Specifies the directory to use for the app-domain that is used for running Migrations
    code such that the app-domain is able to find all required assemblies. This is an
    advanced option that should only be needed if the solution contains	several projects
    such that the assemblies needed for the context and configuration are not all
    referenced from either the project containing the context or the project containing
    the migrations.

.EXAMPLE
    Enable-Migrations
    # Scaffold a migrations configuration in a project with only one context

.EXAMPLE
    Enable-Migrations -Auto
    # Scaffold a migrations configuration with automatic migrations enabled for a project
    # with only one context

.EXAMPLE
    Enable-Migrations -ContextTypeName MyContext -MigrationsDirectory DirectoryName
    # Scaffold a migrations configuration for a project with multiple contexts
    # This scaffolds a migrations configuration for MyContext and will put the configuration
    # and subsequent configurations in a new directory called "DirectoryName"

#>
function Enable-Migrations
{
    [CmdletBinding(DefaultParameterSetName = 'ConnectionStringName', PositionalBinding = $false)]
    param(
        [string] $ContextTypeName,
        [alias('Auto')]
        [switch] $EnableAutomaticMigrations,
        [string] $MigrationsDirectory,
        [string] $ProjectName,
        [string] $StartUpProjectName,
        [string] $ContextProjectName,
        [parameter(ParameterSetName = 'ConnectionStringName')]
        [string] $ConnectionStringName,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionString,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionProviderName,
        [switch] $Force,
        [string] $ContextAssemblyName,
        [string] $AppDomainBaseDirectory)

    WarnIfOtherEFs 'Enable-Migrations'

    $project = GetProject $ProjectName
    $startupProject = GetStartupProject $StartUpProjectName $project

    if (!$ContextAssemblyName -and $ContextProjectName)
    {
        $contextProject = Get-Project $ContextProjectName
        $ContextAssemblyName = GetProperty $contextProject.Properties 'AssemblyName'
    }

    $params = 'migrations', 'enable', '--json'

    if ($ContextTypeName)
    {
        $params += '--context', $ContextTypeName
    }

    if ($ContextAssemblyName)
    {
        $params += '--context-assembly', $ContextAssemblyName
    }

    if ($EnableAutomaticMigrations)
    {
        $params += '--auto'
    }

    if ($MigrationsDirectory)
    {
        $params += '--migrations-dir', $MigrationsDirectory
    }

    $params += GetParams $ConnectionStringName $ConnectionString $ConnectionProviderName

    if ($Force)
    {
        $params += '--force'
    }

    # NB: -join is here to support ConvertFrom-Json on PowerShell 3.0
    $result = (EF6 $project $startupProject $AppDomainBaseDirectory $params) -join "`n" | ConvertFrom-Json

    $project.ProjectItems.AddFromFile($result.migrationsConfiguration) | Out-Null
    $DTE.ItemOperations.OpenFile($result.migrationsConfiguration) | Out-Null
    ShowConsole

    if ($result.migration)
    {
        $project.ProjectItems.AddFromFile($result.migration) | Out-Null
        $resourcesProperties = $project.ProjectItems.AddFromFile($result.migrationResources).Properties
        $project.ProjectItems.AddFromFile($result.migrationDesigner) | Out-Null
    }
}

<#
.SYNOPSIS
    Scaffolds a migration script for any pending model changes.

.DESCRIPTION
    Scaffolds a new migration script and adds it to the project.

.PARAMETER Name
    Specifies the name of the custom script.

.PARAMETER Force
    Specifies that the migration user code be overwritten when re-scaffolding an
    existing migration.

.PARAMETER ProjectName
    Specifies the project that contains the migration configuration type to be
    used. If omitted, the default project selected in package manager console
    is used.

.PARAMETER StartUpProjectName
    Specifies the configuration file to use for named connection strings. If
    omitted, the specified project's configuration file is used.

.PARAMETER ConfigurationTypeName
    Specifies the migrations configuration to use. If omitted, migrations will
    attempt to locate a single migrations configuration type in the target
    project.

.PARAMETER ConnectionStringName
    Specifies the name of a connection string to use from the application's
    configuration file.

.PARAMETER ConnectionString
    Specifies the connection string to use. If omitted, the context's
    default connection will be used.

.PARAMETER ConnectionProviderName
    Specifies the provider invariant name of the connection string.

.PARAMETER IgnoreChanges
    Scaffolds an empty migration ignoring any pending changes detected in the current model.
    This can be used to create an initial, empty migration to enable Migrations for an existing
    database. N.B. Doing this assumes that the target database schema is compatible with the
    current model.

.PARAMETER AppDomainBaseDirectory
    Specifies the directory to use for the app-domain that is used for running Migrations
    code such that the app-domain is able to find all required assemblies. This is an
    advanced option that should only be needed if the solution contains	several projects
    such that the assemblies needed for the context and configuration are not all
    referenced from either the project containing the context or the project containing
    the migrations.

.EXAMPLE
    Add-Migration First
    # Scaffold a new migration named "First"

.EXAMPLE
    Add-Migration First -IgnoreChanges
    # Scaffold an empty migration ignoring any pending changes detected in the current model.
    # This can be used to create an initial, empty migration to enable Migrations for an existing
    # database. N.B. Doing this assumes that the target database schema is compatible with the
    # current model.

#>
function Add-Migration
{
    [CmdletBinding(DefaultParameterSetName = 'ConnectionStringName', PositionalBinding = $false)]
    param(
        [parameter(Position = 0, Mandatory = $true)]
        [string] $Name,
        [switch] $Force,
        [string] $ProjectName,
        [string] $StartUpProjectName,
        [string] $ConfigurationTypeName,
        [parameter(ParameterSetName = 'ConnectionStringName')]
        [string] $ConnectionStringName,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionString,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionProviderName,
        [switch] $IgnoreChanges,
        [string] $AppDomainBaseDirectory)

    WarnIfOtherEFs 'Add-Migration'

    $project = GetProject $ProjectName
    $startupProject = GetStartupProject $StartUpProjectName $project

    $params = 'migrations', 'add', $Name, '--json'

    if ($Force)
    {
        $params += '--force'
    }

    if ($ConfigurationTypeName)
    {
        $params += '--migrations-config', $ConfigurationTypeName
    }

    if ($IgnoreChanges)
    {
        $params += '--ignore-changes'
    }

    $params += GetParams $ConnectionStringName $ConnectionString $ConnectionProviderName

    # NB: -join is here to support ConvertFrom-Json on PowerShell 3.0
    $result = (EF6 $project $startupProject $AppDomainBaseDirectory $params) -join "`n" | ConvertFrom-Json

    $project.ProjectItems.AddFromFile($result.migration) | Out-Null
    $DTE.ItemOperations.OpenFile($result.migration) | Out-Null
    $resourcesProperties = $project.ProjectItems.AddFromFile($result.migrationResources).Properties
    $project.ProjectItems.AddFromFile($result.migrationDesigner) | Out-Null
}

<#
.SYNOPSIS
    Applies any pending migrations to the database.

.DESCRIPTION
    Updates the database to the current model by applying pending migrations.

.PARAMETER SourceMigration
    Only valid with -Script. Specifies the name of a particular migration to use
    as the update's starting point. If omitted, the last applied migration in
    the database will be used.

.PARAMETER TargetMigration
    Specifies the name of a particular migration to update the database to. If
    omitted, the current model will be used.

.PARAMETER Script
    Generate a SQL script rather than executing the pending changes directly.

.PARAMETER Force
    Specifies that data loss is acceptable during automatic migration of the
    database.

.PARAMETER ProjectName
    Specifies the project that contains the migration configuration type to be
    used. If omitted, the default project selected in package manager console
    is used.

.PARAMETER StartUpProjectName
    Specifies the configuration file to use for named connection strings. If
    omitted, the specified project's configuration file is used.

.PARAMETER ConfigurationTypeName
    Specifies the migrations configuration to use. If omitted, migrations will
    attempt to locate a single migrations configuration type in the target
    project.

.PARAMETER ConnectionStringName
    Specifies the name of a connection string to use from the application's
    configuration file.

.PARAMETER ConnectionString
    Specifies the connection string to use. If omitted, the context's
    default connection will be used.

.PARAMETER ConnectionProviderName
    Specifies the provider invariant name of the connection string.

.PARAMETER AppDomainBaseDirectory
    Specifies the directory to use for the app-domain that is used for running Migrations
    code such that the app-domain is able to find all required assemblies. This is an
    advanced option that should only be needed if the solution contains	several projects
    such that the assemblies needed for the context and configuration are not all
    referenced from either the project containing the context or the project containing
    the migrations.

.EXAMPLE
    Update-Database
    # Update the database to the latest migration

.EXAMPLE
    Update-Database -TargetMigration Second
    # Update database to a migration named "Second"
    # This will apply migrations if the target hasn't been applied or roll back migrations
    # if it has

.EXAMPLE
    Update-Database -Script
    # Generate a script to update the database from its current state to the latest migration

.EXAMPLE
    Update-Database -Script -SourceMigration Second -TargetMigration First
    # Generate a script to migrate the database from a specified start migration
    # named "Second" to a specified target migration named "First"

.EXAMPLE
    Update-Database -Script -SourceMigration $InitialDatabase
    # Generate a script that can upgrade a database currently at any version to the latest version.
    # The generated script includes logic to check the __MigrationsHistory table and only apply changes
    # that haven't been previously applied.

.EXAMPLE
    Update-Database -TargetMigration $InitialDatabase
    # Runs the Down method to roll-back any migrations that have been applied to the database


#>
function Update-Database
{
    [CmdletBinding(DefaultParameterSetName = 'ConnectionStringName', PositionalBinding = $false)]
    param(
        [string] $SourceMigration,
        [string] $TargetMigration,
        [switch] $Script,
        [switch] $Force,
        [string] $ProjectName,
        [string] $StartUpProjectName,
        [string] $ConfigurationTypeName,
        [parameter(ParameterSetName = 'ConnectionStringName')]
        [string] $ConnectionStringName,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionString,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionProviderName,
        [string] $AppDomainBaseDirectory)

    WarnIfOtherEFs 'Update-Database'

    $project = GetProject $ProjectName
    $startupProject = GetStartupProject $StartUpProjectName $project

    $params = 'database', 'update'

    if ($SourceMigration)
    {
        $params += '--source', $SourceMigration
    }

    if ($TargetMigration)
    {
        $params += '--target', $TargetMigration
    }

    if ($Script)
    {
        $params += '--script'
    }

    if ($Force)
    {
        $params += '--force'
    }

    if ($ConfigurationTypeName)
    {
        $params += '--migrations-config', $ConfigurationTypeName
    }

    $params += GetParams $ConnectionStringName $ConnectionString $ConnectionProviderName

    $result = (EF6 $project $startupProject $AppDomainBaseDirectory $params) -join "`n"
    if ($result)
    {
        try
        {
            $window = $DTE.ItemOperations.NewFile('General\Sql File')
            $textDocument = $window.Document.Object('TextDocument')
            $editPoint = $textDocument.StartPoint.CreateEditPoint()
            $editPoint.Insert($result)
        }
        catch
        {
            $intermediatePath = GetIntermediatePath $project
            if (![IO.Path]::IsPathRooted($intermediatePath))
            {
                $projectDir = GetProperty $project.Properties 'FullPath'
                $intermediatePath = Join-Path $projectDir $intermediatePath -Resolve | Convert-Path
            }

            $fileName = [IO.Path]::ChangeExtension([IO.Path]::GetRandomFileName(), '.sql')
            $sqlFile = Join-Path $intermediatePath $fileName

            [IO.File]::WriteAllText($sqlFile, $result)

            $DTE.ItemOperations.OpenFile($sqlFile) | Out-Null
        }

        ShowConsole
    }
}

<#
.SYNOPSIS
    Displays the migrations that have been applied to the target database.

.DESCRIPTION
    Displays the migrations that have been applied to the target database.

.PARAMETER ProjectName
    Specifies the project that contains the migration configuration type to be
    used. If omitted, the default project selected in package manager console
    is used.

.PARAMETER StartUpProjectName
    Specifies the configuration file to use for named connection strings. If
    omitted, the specified project's configuration file is used.

.PARAMETER ConfigurationTypeName
    Specifies the migrations configuration to use. If omitted, migrations will
    attempt to locate a single migrations configuration type in the target
    project.

.PARAMETER ConnectionStringName
    Specifies the name of a connection string to use from the application's
    configuration file.

.PARAMETER ConnectionString
    Specifies the connection string to use. If omitted, the context's
    default connection will be used.

.PARAMETER ConnectionProviderName
    Specifies the provider invariant name of the connection string.

.PARAMETER AppDomainBaseDirectory
    Specifies the directory to use for the app-domain that is used for running Migrations
    code such that the app-domain is able to find all required assemblies. This is an
    advanced option that should only be needed if the solution contains	several projects
    such that the assemblies needed for the context and configuration are not all
    referenced from either the project containing the context or the project containing
    the migrations.
#>
function Get-Migrations
{
    [CmdletBinding(DefaultParameterSetName = 'ConnectionStringName', PositionalBinding = $false)]
    param(
        [string] $ProjectName,
        [string] $StartUpProjectName,
        [string] $ConfigurationTypeName,
        [parameter(ParameterSetName = 'ConnectionStringName')]
        [string] $ConnectionStringName,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionString,
        [parameter(ParameterSetName = 'ConnectionStringAndProviderName', Mandatory = $true)]
        [string] $ConnectionProviderName,
        [string] $AppDomainBaseDirectory)

    WarnIfOtherEFs 'Get-Migrations'

    $project = GetProject $ProjectName
    $startupProject = GetStartupProject $StartUpProjectName $project

    $params = 'migrations', 'list'

    if ($ConfigurationTypeName)
    {
        $params += '--migrations-config', $ConfigurationTypeName
    }

    $params += GetParams $ConnectionStringName $ConnectionString $ConnectionProviderName

    return EF6 $project $startupProject $AppDomainBaseDirectory $params
}

function WarnIfOtherEFs($cmdlet)
{
    if (Get-Module 'EntityFrameworkCore')
    {
        Write-Warning "Both Entity Framework 6 and Entity Framework Core are installed. The Entity Framework 6 tools are running. Use 'EntityFrameworkCore\$cmdlet' for Entity Framework Core."
    }

    if (Get-Module 'EntityFramework')
    {
        Write-Warning "A version of Entity Framework older than 6.3 is also installed. The newer tools are running. Use 'EntityFramework\$cmdlet' for the older version."
    }
}

function GetProject($projectName)
{
    if (!$projectName)
    {
        return Get-Project
    }

    return Get-Project $projectName
}

function GetStartupProject($name, $fallbackProject)
{
    if ($name)
    {
        return Get-Project $name
    }

    $startupProjectPaths = $DTE.Solution.SolutionBuild.StartupProjects
    if ($startupProjectPaths)
    {
        if ($startupProjectPaths.Length -eq 1)
        {
            $startupProjectPath = $startupProjectPaths[0]
            if (![IO.Path]::IsPathRooted($startupProjectPath))
            {
                $solutionPath = Split-Path (GetProperty $DTE.Solution.Properties 'Path')
                $startupProjectPath = Join-Path $solutionPath $startupProjectPath -Resolve | Convert-Path
            }

            $startupProject = GetSolutionProjects |
                ?{
                    try
                    {
                        $fullName = $_.FullName
                    }
                    catch [NotImplementedException]
                    {
                        return $false
                    }

                    if ($fullName -and $fullName.EndsWith('\'))
                    {
                        $fullName = $fullName.Substring(0, $fullName.Length - 1)
                    }

                    return $fullName -eq $startupProjectPath
                }
            if ($startupProject)
            {
                return $startupProject
            }

            Write-Warning "Unable to resolve startup project '$startupProjectPath'."
        }
        else
        {
            Write-Warning 'Multiple startup projects set.'
        }
    }
    else
    {
        Write-Warning 'No startup project set.'
    }

    Write-Warning "Using project '$($fallbackProject.ProjectName)' as the startup project."

    return $fallbackProject
}

function GetSolutionProjects()
{
    $projects = New-Object 'System.Collections.Stack'

    $DTE.Solution.Projects |
        %{ $projects.Push($_) }

    while ($projects.Count)
    {
        $project = $projects.Pop();

        <# yield return #> $project

        if ($project.ProjectItems)
        {
            $project.ProjectItems |
                ?{ $_.SubProject } |
                %{ $projects.Push($_.SubProject) }
        }
    }
}

function GetParams($connectionStringName, $connectionString, $connectionProviderName)
{
    $params = @()

    if ($connectionStringName)
    {
        $params += '--connection-string-name', $connectionStringName
    }

    if ($connectionString)
    {
        $params += '--connection-string', $connectionString,
            '--connection-provider', $connectionProviderName
    }

    return $params
}

function ShowConsole
{
    $componentModel = Get-VSComponentModel
    $powerConsoleWindow = $componentModel.GetService([NuGetConsole.IPowerConsoleWindow])
    $powerConsoleWindow.Show()
}

function WriteErrorLine($message)
{
    try
    {
        # Call the internal API NuGet uses to display errors
        $componentModel = Get-VSComponentModel
        $powerConsoleWindow = $componentModel.GetService([NuGetConsole.IPowerConsoleWindow])
        $bindingFlags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::NonPublic
        $activeHostInfo = $powerConsoleWindow.GetType().GetProperty('ActiveHostInfo', $bindingFlags).GetValue($powerConsoleWindow)
        $internalHost = $activeHostInfo.WpfConsole.Host
        $reportErrorMethod = $internalHost.GetType().GetMethod('ReportError', $bindingFlags, $null, [Exception], $null)
        $exception = New-Object Exception $message
        $reportErrorMethod.Invoke($internalHost, $exception)
    }
    catch
    {
        Write-Host $message -ForegroundColor DarkRed
    }
}

function EF6($project, $startupProject, $workingDir, $params)
{
    $solutionBuild = $DTE.Solution.SolutionBuild
    $solutionBuild.BuildProject(
        $solutionBuild.ActiveConfiguration.Name,
        $project.UniqueName,
        <# WaitForBuildToFinish #> $true)
    if ($solutionBuild.LastBuildInfo)
    {
        throw "The project '$($project.ProjectName)' failed to build."
    }

    $projectDir = GetProperty $project.Properties 'FullPath'
    $outputPath = GetProperty $project.ConfigurationManager.ActiveConfiguration.Properties 'OutputPath'
    $targetDir = [IO.Path]::GetFullPath([IO.Path]::Combine($projectDir, $outputPath))
    $targetFrameworkMoniker = GetProperty $project.Properties 'TargetFrameworkMoniker'
    $frameworkName = New-Object 'System.Runtime.Versioning.FrameworkName' $targetFrameworkMoniker
    $targetFrameworkIdentifier = $frameworkName.Identifier
    $targetFrameworkVersion = $frameworkName.Version

    if ($targetFrameworkIdentifier -in '.NETFramework')
    {
        if ($targetFrameworkVersion -lt '4.5')
        {
            $frameworkDir = 'net40'
        }
        else
        {
            $frameworkDir = 'net45'
        }

        $platformTarget = GetPlatformTarget $project
        if ($platformTarget -eq 'x86')
        {
            $runtimeDir = 'win-x86'
        }
        elseif ($platformTarget -in 'AnyCPU', 'x64')
        {
            $runtimeDir = 'any'
        }
        else
        {
            throw "Project '$($project.ProjectName)' has an active platform of '$platformTarget'. Select a different " +
                'platform and try again.'
        }

        $exePath = Join-Path $PSScriptRoot "$frameworkDir\$runtimeDir\ef6.exe"
    }
    elseif ($targetFrameworkIdentifier -eq '.NETCoreApp')
    {
        $exePath = (Get-Command 'dotnet').Path

        $targetName = GetProperty $project.Properties 'AssemblyName'
        $depsFile = Join-Path $targetDir ($targetName + '.deps.json')
        $projectAssetsFile = GetCpsProperty $project 'ProjectAssetsFile'
        $runtimeConfig = Join-Path $targetDir ($targetName + '.runtimeconfig.json')
        $runtimeFrameworkVersion = GetCpsProperty $project 'RuntimeFrameworkVersion'
        $efPath = Join-Path $PSScriptRoot 'netcoreapp3.0\any\ef6.dll'

        $dotnetParams = 'exec', '--depsfile', $depsFile

        if ($projectAssetsFile)
        {
            # NB: Don't use Get-Content. It doesn't handle UTF-8 without a signature
            # NB: Don't use ReadAllLines. ConvertFrom-Json won't work on PowerShell 3.0
            $projectAssets = [IO.File]::ReadAllText($projectAssetsFile) | ConvertFrom-Json
            $projectAssets.packageFolders.psobject.Properties.Name |
                %{ $dotnetParams += '--additionalprobingpath', $_.TrimEnd('\') }
        }

        if (Test-Path $runtimeConfig)
        {
            $dotnetParams += '--runtimeconfig', $runtimeConfig
        }
        elseif ($runtimeFrameworkVersion)
        {
            $dotnetParams += '--fx-version', $runtimeFrameworkVersion
        }

        $dotnetParams += $efPath

        $params = $dotnetParams + $params
    }
    else
    {
        throw "Project '$($startupProject.ProjectName)' targets framework '$targetFrameworkIdentifier'. The Entity Framework " +
            'Package Manager Console Tools don''t support this framework.'
    }

    $targetFileName = GetProperty $project.Properties 'OutputFileName'
    $targetPath = Join-Path $targetDir $targetFileName
    $rootNamespace = GetProperty $project.Properties 'RootNamespace'
    $language = GetLanguage $project

    $params += '--verbose',
        '--no-color',
        '--prefix-output',
        '--assembly', $targetPath,
        '--project-dir', $projectDir,
        '--language', $language

    if (IsWeb $startupProject)
    {
        $startupProjectDir = GetProperty $startupProject.Properties 'FullPath'
        $params += '--data-dir', (Join-Path $startupProjectDir 'App_Data')
    }

    if ($rootNamespace)
    {
        $params += '--root-namespace', $rootNamespace
    }

    $configFile = GetConfigPath $startupProject
    if ($configFile)
    {
        $params += '--config', $configFile
    }

    if (!$workingDir)
    {
        $workingDir = $targetDir
    }

    $arguments = ToArguments $params
    $startInfo = New-Object 'System.Diagnostics.ProcessStartInfo' -Property @{
        FileName = $exePath;
        Arguments = $arguments;
        UseShellExecute = $false;
        CreateNoWindow = $true;
        RedirectStandardOutput = $true;
        StandardOutputEncoding = [Text.Encoding]::UTF8;
        RedirectStandardError = $true;
        WorkingDirectory = $workingDir;
    }

    Write-Verbose "$exePath $arguments"

    $process = [Diagnostics.Process]::Start($startInfo)

    while (($line = $process.StandardOutput.ReadLine()) -ne $null)
    {
        $level = $null
        $text = $null

        $parts = $line.Split(':', 2)
        if ($parts.Length -eq 2)
        {
            $level = $parts[0]

            $i = 0
            $count = 8 - $level.Length
            while ($i -lt $count -and $parts[1][$i] -eq ' ')
            {
                $i++
            }

            $text = $parts[1].Substring($i)
        }

        switch ($level)
        {
            'error' { WriteErrorLine $text }
            'warn' { Write-Warning $text }
            'info' { Write-Host $text }
            'data' { Write-Output $text }
            'verbose' { Write-Verbose $text }
            default { Write-Host $line }
        }
    }

    $process.WaitForExit()

    if ($process.ExitCode)
    {
        while (($line = $process.StandardError.ReadLine()) -ne $null)
        {
            WriteErrorLine $line
        }

        exit
    }
}

function IsCpsProject($project)
{
    $hierarchy = GetVsHierarchy $project
    $isCapabilityMatch = [Microsoft.VisualStudio.Shell.PackageUtilities].GetMethod(
        'IsCapabilityMatch',
        [type[]]([Microsoft.VisualStudio.Shell.Interop.IVsHierarchy], [string]))

    return $isCapabilityMatch.Invoke($null, ($hierarchy, 'CPS'))
}

function IsWeb($project)
{
    $hierarchy = GetVsHierarchy $project

    $aggregatableProject = Get-Interface $hierarchy 'Microsoft.VisualStudio.Shell.Interop.IVsAggregatableProject'
    if (!$aggregatableProject)
    {
        $projectTypes = $project.Kind
    }
    else
    {
        $projectTypeGuids = $null
        $hr = $aggregatableProject.GetAggregateProjectTypeGuids([ref] $projectTypeGuids)
        [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr)

        $projectTypes = $projectTypeGuids.Split(';')
    }

    foreach ($projectType in $projectTypes)
    {
        if ($projectType -in '{349C5851-65DF-11DA-9384-00065B846F21}', '{E24C65DC-7377-472B-9ABA-BC803B73C61A}')
        {
            return $true
        }
    }

    return $false;
}

function GetIntermediatePath($project)
{
    $intermediatePath = GetProperty $project.ConfigurationManager.ActiveConfiguration.Properties 'IntermediatePath'
    if ($intermediatePath)
    {
        return $intermediatePath
    }

    return GetMSBuildProperty $project 'IntermediateOutputPath'
}

function GetPlatformTarget($project)
{
    if (IsCpsProject $project)
    {
        $platformTarget = GetCpsProperty $project 'PlatformTarget'
        if ($platformTarget)
        {
            return $platformTarget
        }

        return GetCpsProperty $project 'Platform'
    }

    $platformTarget = GetProperty $project.ConfigurationManager.ActiveConfiguration.Properties 'PlatformTarget'
    if ($platformTarget)
    {
        return $platformTarget
    }

    # NB: For classic F# projects
    $platformTarget = GetMSBuildProperty $project 'PlatformTarget'
    if ($platformTarget)
    {
        return $platformTarget
    }

    return 'AnyCPU'
}

function GetLanguage($project)
{
    if (IsCpsProject $project)
    {
        return GetCpsProperty $project 'Language'
    }

    return GetMSBuildProperty $project 'Language'
}

function GetVsHierarchy($project)
{
    $solution = Get-VSService 'Microsoft.VisualStudio.Shell.Interop.SVsSolution' 'Microsoft.VisualStudio.Shell.Interop.IVsSolution'
    $hierarchy = $null
    $hr = $solution.GetProjectOfUniqueName($project.UniqueName, [ref] $hierarchy)
    [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr)

    return $hierarchy
}

function GetProperty($properties, $propertyName)
{
    try
    {
        return $properties.Item($propertyName).Value
    }
    catch
    {
        return $null
    }
}

function GetCpsProperty($project, $propertyName)
{
    $browseObjectContext = Get-Interface $project 'Microsoft.VisualStudio.ProjectSystem.Properties.IVsBrowseObjectContext'
    $unconfiguredProject = $browseObjectContext.UnconfiguredProject
    $configuredProject = $unconfiguredProject.GetSuggestedConfiguredProjectAsync().Result
    $properties = $configuredProject.Services.ProjectPropertiesProvider.GetCommonProperties()

    return $properties.GetEvaluatedPropertyValueAsync($propertyName).Result
}

function GetMSBuildProperty($project, $propertyName)
{
    $msbuildProject = [Microsoft.Build.Evaluation.ProjectCollection]::GlobalProjectCollection.LoadedProjects |
        where FullPath -eq $project.FullName

    return $msbuildProject.GetProperty($propertyName).EvaluatedValue
}

function ToArguments($params)
{
    $arguments = ''
    for ($i = 0; $i -lt $params.Length; $i++)
    {
        if ($i)
        {
            $arguments += ' '
        }

        if (!$params[$i].Contains(' '))
        {
            $arguments += $params[$i]

            continue
        }

        $arguments += '"'

        $pendingBackslashs = 0
        for ($j = 0; $j -lt $params[$i].Length; $j++)
        {
            switch ($params[$i][$j])
            {
                '"'
                {
                    if ($pendingBackslashs)
                    {
                        $arguments += '\' * $pendingBackslashs * 2
                        $pendingBackslashs = 0
                    }
                    $arguments += '\"'
                }

                '\'
                {
                    $pendingBackslashs++
                }

                default
                {
                    if ($pendingBackslashs)
                    {
                        if ($pendingBackslashs -eq 1)
                        {
                            $arguments += '\'
                        }
                        else
                        {
                            $arguments += '\' * $pendingBackslashs * 2
                        }

                        $pendingBackslashs = 0
                    }

                    $arguments += $params[$i][$j]
                }
            }
        }

        if ($pendingBackslashs)
        {
            $arguments += '\' * $pendingBackslashs * 2
        }

        $arguments += '"'
    }

    return $arguments
}

function GetConfigPath($project)
{
    if (IsWeb $project)
    {
        $configFileName = 'web.config'
    }
    else
    {
        $configFileName = 'app.config'
    }

    $item = $project.ProjectItems |
        where Name -eq $configFileName |
        select -First 1

    return GetProperty $item.Properties 'FullPath'
}

Export-ModuleMember 'Add-EFDefaultConnectionFactory', 'Add-EFProvider', 'Add-Migration', 'Enable-Migrations', 'Get-Migrations', 'Update-Database' -Variable 'InitialDatabase'

# SIG # Begin signature block
# MIIkXwYJKoZIhvcNAQcCoIIkUDCCJEwCAQExDzANBglghkgBZQMEAgEFADB5Bgor
# BgEEAYI3AgEEoGswaTA0BgorBgEEAYI3AgEeMCYCAwEAAAQQH8w7YFlLCE63JNLG
# KX7zUQIBAAIBAAIBAAIBAAIBADAxMA0GCWCGSAFlAwQCAQUABCBU8UKKdFAqCZNi
# qPoRSiuscSg+YrZwC3TMOd7p8fuNZKCCDYUwggYDMIID66ADAgECAhMzAAABUptA
# n1BWmXWIAAAAAAFSMA0GCSqGSIb3DQEBCwUAMH4xCzAJBgNVBAYTAlVTMRMwEQYD
# VQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNy
# b3NvZnQgQ29ycG9yYXRpb24xKDAmBgNVBAMTH01pY3Jvc29mdCBDb2RlIFNpZ25p
# bmcgUENBIDIwMTEwHhcNMTkwNTAyMjEzNzQ2WhcNMjAwNTAyMjEzNzQ2WjB0MQsw
# CQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9u
# ZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMR4wHAYDVQQDExVNaWNy
# b3NvZnQgQ29ycG9yYXRpb24wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIB
# AQCxp4nT9qfu9O10iJyewYXHlN+WEh79Noor9nhM6enUNbCbhX9vS+8c/3eIVazS
# YnVBTqLzW7xWN1bCcItDbsEzKEE2BswSun7J9xCaLwcGHKFr+qWUlz7hh9RcmjYS
# kOGNybOfrgj3sm0DStoK8ljwEyUVeRfMHx9E/7Ca/OEq2cXBT3L0fVnlEkfal310
# EFCLDo2BrE35NGRjG+/nnZiqKqEh5lWNk33JV8/I0fIcUKrLEmUGrv0CgC7w2cjm
# bBhBIJ+0KzSnSWingXol/3iUdBBy4QQNH767kYGunJeY08RjHMIgjJCdAoEM+2mX
# v1phaV7j+M3dNzZ/cdsz3oDfAgMBAAGjggGCMIIBfjAfBgNVHSUEGDAWBgorBgEE
# AYI3TAgBBggrBgEFBQcDAzAdBgNVHQ4EFgQU3f8Aw1sW72WcJ2bo/QSYGzVrRYcw
# VAYDVR0RBE0wS6RJMEcxLTArBgNVBAsTJE1pY3Jvc29mdCBJcmVsYW5kIE9wZXJh
# dGlvbnMgTGltaXRlZDEWMBQGA1UEBRMNMjMwMDEyKzQ1NDEzNjAfBgNVHSMEGDAW
# gBRIbmTlUAXTgqoXNzcitW2oynUClTBUBgNVHR8ETTBLMEmgR6BFhkNodHRwOi8v
# d3d3Lm1pY3Jvc29mdC5jb20vcGtpb3BzL2NybC9NaWNDb2RTaWdQQ0EyMDExXzIw
# MTEtMDctMDguY3JsMGEGCCsGAQUFBwEBBFUwUzBRBggrBgEFBQcwAoZFaHR0cDov
# L3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9jZXJ0cy9NaWNDb2RTaWdQQ0EyMDEx
# XzIwMTEtMDctMDguY3J0MAwGA1UdEwEB/wQCMAAwDQYJKoZIhvcNAQELBQADggIB
# AJTwROaHvogXgixWjyjvLfiRgqI2QK8GoG23eqAgNjX7V/WdUWBbs0aIC3k49cd0
# zdq+JJImixcX6UOTpz2LZPFSh23l0/Mo35wG7JXUxgO0U+5drbQht5xoMl1n7/TQ
# 4iKcmAYSAPxTq5lFnoV2+fAeljVA7O43szjs7LR09D0wFHwzZco/iE8Hlakl23ZT
# 7FnB5AfU2hwfv87y3q3a5qFiugSykILpK0/vqnlEVB0KAdQVzYULQ/U4eFEjnis3
# Js9UrAvtIhIs26445Rj3UP6U4GgOjgQonlRA+mDlsh78wFSGbASIvK+fkONUhvj8
# B8ZHNn4TFfnct+a0ZueY4f6aRPxr8beNSUKn7QW/FQmn422bE7KfnqWncsH7vbNh
# G929prVHPsaa7J22i9wyHj7m0oATXJ+YjfyoEAtd5/NyIYaE4Uu0j1EhuYUo5VaJ
# JnMaTER0qX8+/YZRWrFN/heps41XNVjiAawpbAa0fUa3R9RNBjPiBnM0gvNPorM4
# dsV2VJ8GluIQOrJlOvuCrOYDGirGnadOmQ21wPBoGFCWpK56PxzliKsy5NNmAXcE
# x7Qb9vUjY1WlYtrdwOXTpxN4slzIht69BaZlLIjLVWwqIfuNrhHKNDM9K+v7vgrI
# bf7l5/665g0gjQCDCN6Q5sxuttTAEKtJeS/pkpI+DbZ/MIIHejCCBWKgAwIBAgIK
# YQ6Q0gAAAAAAAzANBgkqhkiG9w0BAQsFADCBiDELMAkGA1UEBhMCVVMxEzARBgNV
# BAgTCldhc2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jv
# c29mdCBDb3Jwb3JhdGlvbjEyMDAGA1UEAxMpTWljcm9zb2Z0IFJvb3QgQ2VydGlm
# aWNhdGUgQXV0aG9yaXR5IDIwMTEwHhcNMTEwNzA4MjA1OTA5WhcNMjYwNzA4MjEw
# OTA5WjB+MQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UE
# BxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSgwJgYD
# VQQDEx9NaWNyb3NvZnQgQ29kZSBTaWduaW5nIFBDQSAyMDExMIICIjANBgkqhkiG
# 9w0BAQEFAAOCAg8AMIICCgKCAgEAq/D6chAcLq3YbqqCEE00uvK2WCGfQhsqa+la
# UKq4BjgaBEm6f8MMHt03a8YS2AvwOMKZBrDIOdUBFDFC04kNeWSHfpRgJGyvnkmc
# 6Whe0t+bU7IKLMOv2akrrnoJr9eWWcpgGgXpZnboMlImEi/nqwhQz7NEt13YxC4D
# dato88tt8zpcoRb0RrrgOGSsbmQ1eKagYw8t00CT+OPeBw3VXHmlSSnnDb6gE3e+
# lD3v++MrWhAfTVYoonpy4BI6t0le2O3tQ5GD2Xuye4Yb2T6xjF3oiU+EGvKhL1nk
# kDstrjNYxbc+/jLTswM9sbKvkjh+0p2ALPVOVpEhNSXDOW5kf1O6nA+tGSOEy/S6
# A4aN91/w0FK/jJSHvMAhdCVfGCi2zCcoOCWYOUo2z3yxkq4cI6epZuxhH2rhKEmd
# X4jiJV3TIUs+UsS1Vz8kA/DRelsv1SPjcF0PUUZ3s/gA4bysAoJf28AVs70b1FVL
# 5zmhD+kjSbwYuER8ReTBw3J64HLnJN+/RpnF78IcV9uDjexNSTCnq47f7Fufr/zd
# sGbiwZeBe+3W7UvnSSmnEyimp31ngOaKYnhfsi+E11ecXL93KCjx7W3DKI8sj0A3
# T8HhhUSJxAlMxdSlQy90lfdu+HggWCwTXWCVmj5PM4TasIgX3p5O9JawvEagbJjS
# 4NaIjAsCAwEAAaOCAe0wggHpMBAGCSsGAQQBgjcVAQQDAgEAMB0GA1UdDgQWBBRI
# bmTlUAXTgqoXNzcitW2oynUClTAZBgkrBgEEAYI3FAIEDB4KAFMAdQBiAEMAQTAL
# BgNVHQ8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAfBgNVHSMEGDAWgBRyLToCMZBD
# uRQFTuHqp8cx0SOJNDBaBgNVHR8EUzBRME+gTaBLhklodHRwOi8vY3JsLm1pY3Jv
# c29mdC5jb20vcGtpL2NybC9wcm9kdWN0cy9NaWNSb29DZXJBdXQyMDExXzIwMTFf
# MDNfMjIuY3JsMF4GCCsGAQUFBwEBBFIwUDBOBggrBgEFBQcwAoZCaHR0cDovL3d3
# dy5taWNyb3NvZnQuY29tL3BraS9jZXJ0cy9NaWNSb29DZXJBdXQyMDExXzIwMTFf
# MDNfMjIuY3J0MIGfBgNVHSAEgZcwgZQwgZEGCSsGAQQBgjcuAzCBgzA/BggrBgEF
# BQcCARYzaHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraW9wcy9kb2NzL3ByaW1h
# cnljcHMuaHRtMEAGCCsGAQUFBwICMDQeMiAdAEwAZQBnAGEAbABfAHAAbwBsAGkA
# YwB5AF8AcwB0AGEAdABlAG0AZQBuAHQALiAdMA0GCSqGSIb3DQEBCwUAA4ICAQBn
# 8oalmOBUeRou09h0ZyKbC5YR4WOSmUKWfdJ5DJDBZV8uLD74w3LRbYP+vj/oCso7
# v0epo/Np22O/IjWll11lhJB9i0ZQVdgMknzSGksc8zxCi1LQsP1r4z4HLimb5j0b
# pdS1HXeUOeLpZMlEPXh6I/MTfaaQdION9MsmAkYqwooQu6SpBQyb7Wj6aC6VoCo/
# KmtYSWMfCWluWpiW5IP0wI/zRive/DvQvTXvbiWu5a8n7dDd8w6vmSiXmE0OPQvy
# CInWH8MyGOLwxS3OW560STkKxgrCxq2u5bLZ2xWIUUVYODJxJxp/sfQn+N4sOiBp
# mLJZiWhub6e3dMNABQamASooPoI/E01mC8CzTfXhj38cbxV9Rad25UAqZaPDXVJi
# hsMdYzaXht/a8/jyFqGaJ+HNpZfQ7l1jQeNbB5yHPgZ3BtEGsXUfFL5hYbXw3MYb
# BL7fQccOKO7eZS/sl/ahXJbYANahRr1Z85elCUtIEJmAH9AAKcWxm6U/RXceNcbS
# oqKfenoi+kiVH6v7RyOA9Z74v2u3S5fi63V4GuzqN5l5GEv/1rMjaHXmr/r8i+sL
# gOppO6/8MO0ETI7f33VtY5E90Z1WTk+/gFcioXgRMiF670EKsT/7qMykXcGhiJtX
# cVZOSEXAQsmbdlsKgEhr/Xmfwb1tbWrJUnMTDXpQzTGCFjAwghYsAgEBMIGVMH4x
# CzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRt
# b25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xKDAmBgNVBAMTH01p
# Y3Jvc29mdCBDb2RlIFNpZ25pbmcgUENBIDIwMTECEzMAAAFSm0CfUFaZdYgAAAAA
# AVIwDQYJYIZIAWUDBAIBBQCgga4wGQYJKoZIhvcNAQkDMQwGCisGAQQBgjcCAQQw
# HAYKKwYBBAGCNwIBCzEOMAwGCisGAQQBgjcCARUwLwYJKoZIhvcNAQkEMSIEINlr
# YoMQI0s38aqnYes89d7O1smBsAmM5yEpwvrrBd+CMEIGCisGAQQBgjcCAQwxNDAy
# oBSAEgBNAGkAYwByAG8AcwBvAGYAdKEagBhodHRwOi8vd3d3Lm1pY3Jvc29mdC5j
# b20wDQYJKoZIhvcNAQEBBQAEggEAA4wFr+j9nOalk2Cbg/LovvaZmWFRfopTwGj9
# QbzMUO6cby0vTfP/4Mn2UI603aPDCIt96YavP5mbGk2oIHe51CZLRkVZyv2dO0l4
# McDfHEbRYUQ7Ya9FEfpF9FJ5sieT8hKbqkj0ajqLAHEmW6kVmioXqj0xQya3j5zI
# 7t2WnMIDsUNLWYI3dlLo50rPd87ZVxWnDIE2IVhyMMtsK5urrL4WYcgGjT8jihVE
# FbQo9nL5y1hWd0ZSGMfLwCoVmDq4wVki9f5WjT/gPkrS/F+TrP+GZZPvyrhf0PTN
# R0BJPgugbrZr/lfPpPfb8r367uJYNIq0ChMNLrUdmAUWLQn23aGCE7owghO2Bgor
# BgEEAYI3AwMBMYITpjCCE6IGCSqGSIb3DQEHAqCCE5MwghOPAgEDMQ8wDQYJYIZI
# AWUDBAIBBQAwggFYBgsqhkiG9w0BCRABBKCCAUcEggFDMIIBPwIBAQYKKwYBBAGE
# WQoDATAxMA0GCWCGSAFlAwQCAQUABCARzTf7SSdAq/qlhyAN9oDwFAkk/oxC+YnX
# h2AQyOBq8gIGXno7qpjuGBMyMDIwMDQxNjIyMTM0MC45NDFaMAcCAQGAAgH0oIHU
# pIHRMIHOMQswCQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UE
# BxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSkwJwYD
# VQQLEyBNaWNyb3NvZnQgT3BlcmF0aW9ucyBQdWVydG8gUmljbzEmMCQGA1UECxMd
# VGhhbGVzIFRTUyBFU046NTg0Ny1GNzYxLTRGNzAxJTAjBgNVBAMTHE1pY3Jvc29m
# dCBUaW1lLVN0YW1wIFNlcnZpY2Wggg8iMIIE9TCCA92gAwIBAgITMwAAAQUHOepZ
# 81W/KgAAAAABBTANBgkqhkiG9w0BAQsFADB8MQswCQYDVQQGEwJVUzETMBEGA1UE
# CBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwGA1UEChMVTWljcm9z
# b2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1NaWNyb3NvZnQgVGltZS1TdGFtcCBQ
# Q0EgMjAxMDAeFw0xOTA5MDYyMDQxMThaFw0yMDEyMDQyMDQxMThaMIHOMQswCQYD
# VQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEe
# MBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSkwJwYDVQQLEyBNaWNyb3Nv
# ZnQgT3BlcmF0aW9ucyBQdWVydG8gUmljbzEmMCQGA1UECxMdVGhhbGVzIFRTUyBF
# U046NTg0Ny1GNzYxLTRGNzAxJTAjBgNVBAMTHE1pY3Jvc29mdCBUaW1lLVN0YW1w
# IFNlcnZpY2UwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDMIpZjVUiL
# WQGqDFLLaeGfhc9bxCwi8HQx+gcaF5Zz2GodhM71oyjal6uqnRM8QHxj49uKFmY/
# SWEhlV+so3IrmEHVLmskeEQaio5PxVgUWRm+sBIJpS9GjwKrGPZ2ub4ST2J9fu5F
# xbfTmJyB2AL6W7WcSUON8tyuz2/NRAII6YuojdMa6mjVXamL2AS7PBo1GW4Pa4Xb
# NhEQoA4/siS4JGbcfAwVMGv87bhKapDqpXLbDq6LbFdLAv7Q7eUHiHS4eccXRNGA
# npkdhHOK7s1O9FqpRZYsbx/UpkaoyqiQe/JFTA+1keYZsZgaQqgPNpGYD50SDDyQ
# Z2vtNx7KVgXtAgMBAAGjggEbMIIBFzAdBgNVHQ4EFgQUPXQb/rp3KEzK6DYOy3Fn
# /QIzNyIwHwYDVR0jBBgwFoAU1WM6XIoxkPNDe3xGG8UzaFqFbVUwVgYDVR0fBE8w
# TTBLoEmgR4ZFaHR0cDovL2NybC5taWNyb3NvZnQuY29tL3BraS9jcmwvcHJvZHVj
# dHMvTWljVGltU3RhUENBXzIwMTAtMDctMDEuY3JsMFoGCCsGAQUFBwEBBE4wTDBK
# BggrBgEFBQcwAoY+aHR0cDovL3d3dy5taWNyb3NvZnQuY29tL3BraS9jZXJ0cy9N
# aWNUaW1TdGFQQ0FfMjAxMC0wNy0wMS5jcnQwDAYDVR0TAQH/BAIwADATBgNVHSUE
# DDAKBggrBgEFBQcDCDANBgkqhkiG9w0BAQsFAAOCAQEAp85hd3trAVfmVAPmcOAq
# nM47TbWB9S0ySGG/eNvIfhgYC0YjCLEZhiiQyOeRTws0lIOWGv7tM5tr70RGzNo1
# /C7SQadqQ2dT5sUj7Ga6LHO2excdzRvUIwdeOaVuaj4VpiXnhjPBRu2CVNGXPe1d
# 7Zzw7di8xh2D6ooZBjhHLh7yGf2ZFjBjLcDVjrfaLwd4YqefJgg42s8EMUoXzsTp
# PlS0IBKWeX+RbBycOUhXpK9qlvFbBQGp4N+uLEV6haG33oVOtWwrbhu5F0E4UDzs
# FUaZ8OALyKraR1dIo+ZU+zjpn3Na7KUkrT/1UFYdnWYwoUDm9e+DmBhqdhUlxIhR
# nzCCBnEwggRZoAMCAQICCmEJgSoAAAAAAAIwDQYJKoZIhvcNAQELBQAwgYgxCzAJ
# BgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRtb25k
# MR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRpb24xMjAwBgNVBAMTKU1pY3Jv
# c29mdCBSb290IENlcnRpZmljYXRlIEF1dGhvcml0eSAyMDEwMB4XDTEwMDcwMTIx
# MzY1NVoXDTI1MDcwMTIxNDY1NVowfDELMAkGA1UEBhMCVVMxEzARBgNVBAgTCldh
# c2hpbmd0b24xEDAOBgNVBAcTB1JlZG1vbmQxHjAcBgNVBAoTFU1pY3Jvc29mdCBD
# b3Jwb3JhdGlvbjEmMCQGA1UEAxMdTWljcm9zb2Z0IFRpbWUtU3RhbXAgUENBIDIw
# MTAwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCpHQ28dxGKOiDs/BOX
# 9fp/aZRrdFQQ1aUKAIKF++18aEssX8XD5WHCdrc+Zitb8BVTJwQxH0EbGpUdzgkT
# jnxhMFmxMEQP8WCIhFRDDNdNuDgIs0Ldk6zWczBXJoKjRQ3Q6vVHgc2/JGAyWGBG
# 8lhHhjKEHnRhZ5FfgVSxz5NMksHEpl3RYRNuKMYa+YaAu99h/EbBJx0kZxJyGiGK
# r0tkiVBisV39dx898Fd1rL2KQk1AUdEPnAY+Z3/1ZsADlkR+79BL/W7lmsqxqPJ6
# Kgox8NpOBpG2iAg16HgcsOmZzTznL0S6p/TcZL2kAcEgCZN4zfy8wMlEXV4WnAEF
# TyJNAgMBAAGjggHmMIIB4jAQBgkrBgEEAYI3FQEEAwIBADAdBgNVHQ4EFgQU1WM6
# XIoxkPNDe3xGG8UzaFqFbVUwGQYJKwYBBAGCNxQCBAweCgBTAHUAYgBDAEEwCwYD
# VR0PBAQDAgGGMA8GA1UdEwEB/wQFMAMBAf8wHwYDVR0jBBgwFoAU1fZWy4/oolxi
# aNE9lJBb186aGMQwVgYDVR0fBE8wTTBLoEmgR4ZFaHR0cDovL2NybC5taWNyb3Nv
# ZnQuY29tL3BraS9jcmwvcHJvZHVjdHMvTWljUm9vQ2VyQXV0XzIwMTAtMDYtMjMu
# Y3JsMFoGCCsGAQUFBwEBBE4wTDBKBggrBgEFBQcwAoY+aHR0cDovL3d3dy5taWNy
# b3NvZnQuY29tL3BraS9jZXJ0cy9NaWNSb29DZXJBdXRfMjAxMC0wNi0yMy5jcnQw
# gaAGA1UdIAEB/wSBlTCBkjCBjwYJKwYBBAGCNy4DMIGBMD0GCCsGAQUFBwIBFjFo
# dHRwOi8vd3d3Lm1pY3Jvc29mdC5jb20vUEtJL2RvY3MvQ1BTL2RlZmF1bHQuaHRt
# MEAGCCsGAQUFBwICMDQeMiAdAEwAZQBnAGEAbABfAFAAbwBsAGkAYwB5AF8AUwB0
# AGEAdABlAG0AZQBuAHQALiAdMA0GCSqGSIb3DQEBCwUAA4ICAQAH5ohRDeLG4Jg/
# gXEDPZ2joSFvs+umzPUxvs8F4qn++ldtGTCzwsVmyWrf9efweL3HqJ4l4/m87WtU
# VwgrUYJEEvu5U4zM9GASinbMQEBBm9xcF/9c+V4XNZgkVkt070IQyK+/f8Z/8jd9
# Wj8c8pl5SpFSAK84Dxf1L3mBZdmptWvkx872ynoAb0swRCQiPM/tA6WWj1kpvLb9
# BOFwnzJKJ/1Vry/+tuWOM7tiX5rbV0Dp8c6ZZpCM/2pif93FSguRJuI57BlKcWOd
# eyFtw5yjojz6f32WapB4pm3S4Zz5Hfw42JT0xqUKloakvZ4argRCg7i1gJsiOCC1
# JeVk7Pf0v35jWSUPei45V3aicaoGig+JFrphpxHLmtgOR5qAxdDNp9DvfYPw4Ttx
# Cd9ddJgiCGHasFAeb73x4QDf5zEHpJM692VHeOj4qEir995yfmFrb3epgcunCaw5
# u+zGy9iCtHLNHfS4hQEegPsbiSpUObJb2sgNVZl6h3M7COaYLeqN4DMuEin1wC9U
# JyH3yKxO2ii4sanblrKnQqLJzxlBTeCG+SqaoxFmMNO7dDJL32N79ZmKLxvHIa9Z
# ta7cRDyXUHHXodLFVeNp3lfB0d4wwP3M5k37Db9dT+mdHhk4L7zPWAUu7w2gUDXa
# 7wknHNWzfjUeCLraNtvTX4/edIhJEqGCA7AwggKYAgEBMIH+oYHUpIHRMIHOMQsw
# CQYDVQQGEwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9u
# ZDEeMBwGA1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSkwJwYDVQQLEyBNaWNy
# b3NvZnQgT3BlcmF0aW9ucyBQdWVydG8gUmljbzEmMCQGA1UECxMdVGhhbGVzIFRT
# UyBFU046NTg0Ny1GNzYxLTRGNzAxJTAjBgNVBAMTHE1pY3Jvc29mdCBUaW1lLVN0
# YW1wIFNlcnZpY2WiJQoBATAJBgUrDgMCGgUAAxUA0nmc7MiH2Pr0x33n13Zg4RlV
# 9qqggd4wgdukgdgwgdUxCzAJBgNVBAYTAlVTMRMwEQYDVQQIEwpXYXNoaW5ndG9u
# MRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3NvZnQgQ29ycG9yYXRp
# b24xKTAnBgNVBAsTIE1pY3Jvc29mdCBPcGVyYXRpb25zIFB1ZXJ0byBSaWNvMScw
# JQYDVQQLEx5uQ2lwaGVyIE5UUyBFU046NERFOS0wQzVFLTNFMDkxKzApBgNVBAMT
# Ik1pY3Jvc29mdCBUaW1lIFNvdXJjZSBNYXN0ZXIgQ2xvY2swDQYJKoZIhvcNAQEF
# BQACBQDiQwziMCIYDzIwMjAwNDE3MDA1NzA2WhgPMjAyMDA0MTgwMDU3MDZaMHcw
# PQYKKwYBBAGEWQoEATEvMC0wCgIFAOJDDOICAQAwCgIBAAICGcICAf8wBwIBAAIC
# GH4wCgIFAOJEXmICAQAwNgYKKwYBBAGEWQoEAjEoMCYwDAYKKwYBBAGEWQoDAaAK
# MAgCAQACAxbjYKEKMAgCAQACAwehIDANBgkqhkiG9w0BAQUFAAOCAQEATA6xpN+7
# +epEr0I3lwl33d7P6eYuhfTZxDtgP5dr9jnFv/10jXgI47Qs0KHY4jwkeLZ9ExCM
# muBD0RcyOx/T0xkUANz57TNPssoqTztK5hHmt6ZmwTNyzUYxVJ8ARFPp62WhWiJ9
# Tt9vKtuPrDIuVuHzxjY63QEPhZ1+UYAnQwu+DT1XPG1rikQOEXBM9MkzTgD/8AxY
# prHt87u+g7MObUd0t1sAyJI+0lzgJRlqeEAw5pW4CfkzGfEGXPgT/HfjWVIc176l
# C0ntYiOma8s4znFps5hAgnxSApopGy9c9QuuNuOfiSNa3/L5ws6RYulq/qHTuifW
# gZ90UMQ7TrA2VjGCAvUwggLxAgEBMIGTMHwxCzAJBgNVBAYTAlVTMRMwEQYDVQQI
# EwpXYXNoaW5ndG9uMRAwDgYDVQQHEwdSZWRtb25kMR4wHAYDVQQKExVNaWNyb3Nv
# ZnQgQ29ycG9yYXRpb24xJjAkBgNVBAMTHU1pY3Jvc29mdCBUaW1lLVN0YW1wIFBD
# QSAyMDEwAhMzAAABBQc56lnzVb8qAAAAAAEFMA0GCWCGSAFlAwQCAQUAoIIBMjAa
# BgkqhkiG9w0BCQMxDQYLKoZIhvcNAQkQAQQwLwYJKoZIhvcNAQkEMSIEIEIjFCBe
# 4MtXOBW+4EQjXEL8OLx5+eGw0ZT8w0o9gW4DMIHiBgsqhkiG9w0BCRACDDGB0jCB
# zzCBzDCBsQQU0nmc7MiH2Pr0x33n13Zg4RlV9qowgZgwgYCkfjB8MQswCQYDVQQG
# EwJVUzETMBEGA1UECBMKV2FzaGluZ3RvbjEQMA4GA1UEBxMHUmVkbW9uZDEeMBwG
# A1UEChMVTWljcm9zb2Z0IENvcnBvcmF0aW9uMSYwJAYDVQQDEx1NaWNyb3NvZnQg
# VGltZS1TdGFtcCBQQ0EgMjAxMAITMwAAAQUHOepZ81W/KgAAAAABBTAWBBS6OC+C
# 8E5t3KIl3SZn6YRcv4X++TANBgkqhkiG9w0BAQsFAASCAQBtzHRroeehPY5IFmFC
# 0CCu+fgjt2iyDYX1P1rHZUyU1YseSFj4GEaOj5vSW2VKxlJzVl0C5/xZjQCZ73+j
# xRFZaUKSVkh5rPDV7++x6wUcCYAfj+b0QwRh5XH3HYMB8HUwusbG2WRnZCpjmrB6
# EQfRZcvyWiD+Lcc+QXgt0/JyOEtVpMIfwWclbYX3wltt9H3Q1PXQy5pf26A5Yu6Q
# 58h3xsTXCXyJZ3jUrP6qImMS4KrsXrgh6OQWczyL3E+dzOm2OvF8QfErkK0ooXGh
# zbodmkxNfq4WhN/BpRMKsRi8QdURQ1q3qLB2GJ4JjgLBzkhXvEtWD1xqF9AINmTe
# 3n5C
# SIG # End signature block
