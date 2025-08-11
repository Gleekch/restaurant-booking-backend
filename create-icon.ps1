# Script PowerShell pour créer une icône simple
Add-Type -AssemblyName System.Drawing

# Créer une image 256x256
$bitmap = New-Object System.Drawing.Bitmap 256, 256

# Créer un objet Graphics
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)

# Définir la couleur de fond (bleu-vert océan)
$backgroundColor = [System.Drawing.Color]::FromArgb(20, 124, 127)
$graphics.Clear($backgroundColor)

# Ajouter du texte
$font = New-Object System.Drawing.Font("Arial", 72, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$stringFormat = New-Object System.Drawing.StringFormat
$stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
$stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Center

$rectangle = New-Object System.Drawing.Rectangle(0, 0, 256, 256)
$graphics.DrawString("MF", $font, $brush, $rectangle, $stringFormat)

# Sauvegarder en PNG
$bitmap.Save("desktop\assets\icon-256.png", [System.Drawing.Imaging.ImageFormat]::Png)

# Nettoyer
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Icône créée avec succès!"