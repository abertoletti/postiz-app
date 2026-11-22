param(
    [string]$Revision = 'HEAD',
    [string]$Image = 'brand-hub-postiz-source:local'
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$commit = git -C $root rev-parse --verify --end-of-options "${Revision}^{commit}"
if ($LASTEXITCODE -ne 0) { throw "Cannot resolve Git revision $Revision." }

# Archive the Git tree so local environment files, data and uploads never enter Docker.
$temporary = [IO.Directory]::CreateTempSubdirectory('brand-hub-postiz-build-').FullName
try {
    $context = Join-Path $temporary 'source'
    $archive = Join-Path $temporary 'source.tar'
    New-Item -ItemType Directory -Path $context | Out-Null
    git -C $root archive --format=tar --output=$archive $commit
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create the source archive.' }
    tar -xf $archive -C $context
    if ($LASTEXITCODE -ne 0) { throw 'Cannot extract the source archive.' }

    docker build --tag $Image --file (Join-Path $context 'Dockerfile.dev') `
        --build-arg "NEXT_PUBLIC_VERSION=brand-hub-$($commit.Substring(0, 8))" $context
    if ($LASTEXITCODE -ne 0) { throw "Docker build failed for $commit." }
}
finally {
    $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $temporary).Path)
    if ($resolved -eq $temporary -and (Split-Path -Leaf $resolved) -like 'brand-hub-postiz-build-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
