param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$Signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($Signature.Status -ne 'Valid' -or $null -eq $Signature.TimeStamperCertificate) {
  throw 'The desktop installer needs a valid, timestamped Authenticode signature.'
}
