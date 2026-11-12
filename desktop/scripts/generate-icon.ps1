$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$output = Join-Path $PSScriptRoot '..\build\icon.ico'
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$masterSize = 1024
$master = [System.Drawing.Bitmap]::new($masterSize, $masterSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [System.Drawing.Graphics]::FromImage($master)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::Transparent)
$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
$edge = [single]($masterSize - 1)
$radius = [single]275
$diameter = $radius * 2
$path.AddArc(0, 0, $diameter, $diameter, 180, 90)
$path.AddArc($edge - $diameter, 0, $diameter, $diameter, 270, 90)
$path.AddArc($edge - $diameter, $edge - $diameter, $diameter, $diameter, 0, 90)
$path.AddArc(0, $edge - $diameter, $diameter, $diameter, 90, 90)
$path.CloseFigure()
$tile = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(255, 149, 110, 80))
$white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$font = [System.Drawing.Font]::new('Segoe UI', 410, [System.Drawing.FontStyle]::Regular,
  [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
try {
  $graphics.FillPath($tile, $path)
  $graphics.DrawString('JM', $font, $white,
    [System.Drawing.RectangleF]::new(0, -14, $masterSize, $masterSize), $format)

  $images = @()
  foreach ($size in $sizes) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $scaled = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $scaled.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $scaled.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $scaled.Clear([System.Drawing.Color]::Transparent)
      $scaled.DrawImage($master, [System.Drawing.Rectangle]::new(0, 0, $size, $size),
        [System.Drawing.Rectangle]::new(0, 0, $masterSize, $masterSize), [System.Drawing.GraphicsUnit]::Pixel)
      $stream = [System.IO.MemoryStream]::new()
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $images += ,@{ Size = $size; Bytes = $stream.ToArray() }
      } finally { $stream.Dispose() }
    } finally { $scaled.Dispose(); $bitmap.Dispose() }
  }

  $file = [System.IO.File]::Open($output, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = [System.IO.BinaryWriter]::new($file)
  try {
    $writer.Write([uint16]0)
    $writer.Write([uint16]1)
    $writer.Write([uint16]$images.Count)
    $offset = 6 + 16 * $images.Count
    foreach ($image in $images) {
      $writer.Write([byte]($image.Size % 256))
      $writer.Write([byte]($image.Size % 256))
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([uint16]1)
      $writer.Write([uint16]32)
      $writer.Write([uint32]$image.Bytes.Length)
      $writer.Write([uint32]$offset)
      $offset += $image.Bytes.Length
    }
    foreach ($image in $images) { $writer.Write([byte[]]$image.Bytes) }
  } finally { $writer.Dispose(); $file.Dispose() }
} finally {
  $format.Dispose(); $font.Dispose(); $white.Dispose(); $tile.Dispose()
  $path.Dispose(); $graphics.Dispose(); $master.Dispose()
}
Write-Output "Icono generado: $output"
