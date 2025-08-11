@echo off
echo Creation des icones pour l'application...

:: Créer une icône simple en base64 et la convertir
echo iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAABmJLR0QA/wD/AP+gvaeTAAABkElEQVQ4y6WTsUtCURTGf+e+p5FQUBAEQVBQSxAEtQTR0hBEW3+AQ0NDQ0NDQ0M0NQTR1tLWEERDQ0NDEAVBUBAEQRAUREEQFKjvnRZfe/req4f0wYXLPd93vnPO5Qr/jATgBIqAH0gBCeBDRJxfBwRwAUVgA1gHAkAJKAD7wDHwJCLOr4AALmAV2ARCgPtH3e0FokAMeG4l4AHWgG0g2EbeD+wCESDZTKAN7ABhYKhDvA8YBhaAc+BJJ+ABIsAUMNohHmAMmAfWgQFdwA+sAlOdRAECbAF+4F4n4AXm6Pxza0wDY8CdTqAETPYq0GAGGBAg0TQmgwaBLBACxnpR4DnwKyICeIBL4BZwAeWeBMrAsUtE8sBXc2UFCnQhYAOnIvKpT1YCvOhVnzqBR0BEJIO13jXw1OoBEfkGYsBph7gvIAbc6y8kIingCLgAkm08IMA5cCYieaXX+hdJAzGsjXtvI/8IxIG0MhpraydQBW6AM+DKpFutVEyx2CRwA7w1NkzgA1WgAmSA199k/wEYsJBa5+SosQAAAABJRU5ErkJggg== > icon.b64

:: Utiliser PowerShell pour décoder et créer le PNG
powershell -Command "$bytes = [Convert]::FromBase64String((Get-Content icon.b64)); [IO.File]::WriteAllBytes('icon.png', $bytes)"
powershell -Command "$bytes = [Convert]::FromBase64String((Get-Content icon.b64)); [IO.File]::WriteAllBytes('tray-icon.png', $bytes)"

del icon.b64

echo Icones creees avec succes!
pause