# Actualización de la documentación — instrucciones para el commit

Copia el contenido de esta carpeta sobre la raíz del repositorio (`jorge-motors/`), aceptando reemplazar los archivos.

## Archivos que se reemplazan
- `README.md`, `database/README.md`, `docs/README.md`, `docs/modelos/README.md`
- `docs/informe/Arquitectura_Objetivo_Jorge_Motors_Equipo.md` (decisión de node-mssql y estado actual)
- `docs/diagramas/fig01`–`fig05` y `fig09` (`.drawio` y `.png`)

## Archivos nuevos
- `docs/informe/Informe_Final_Jorge_Motors.docx`
- `docs/informe/Exposicion_Final_Jorge_Motors.pptx` y `.pdf`
- `docs/diagramas/fig06_despliegue_azure.drawio` / `.png`
- `docs/modelos/modelo_conceptual`, `modelo_logico`, `modelo_fisico` (`.drawio` y `.png`)
- `docs/capturas/` (11 pantallas de la aplicación)

## Archivos antiguos que hay que borrar
Copiar la carpeta no los elimina; bórralos con git:

```powershell
git rm "docs/informe/Informe_Avance2_Jorge_Motors.docx"
git rm "docs/informe/Exposición_Avance2_Jorge_Motors.pdf"
git rm docs/modelos/modelo_conceptual_lucidchart.png docs/modelos/modelo_logico_lucidchart.png docs/modelos/modelo_fisico_dbeaver.png
```

Si prefieren conservar el Avance 2 como historial, en lugar de borrarlos muévanlos a `docs/informe/avance2/` con `git mv`.

## Se mantienen sin cambios
- `docs/prototipos/` (prototipos de Figma, ahora descritos como diseño inicial)
- `database/schema.sql`, `schema.prisma` y `pruebas/` (marcados como históricos en `database/README.md`)
- Todo el código, la bitácora y las guías `parte-0X`.

## Commit sugerido
```powershell
git checkout -b docs/informe-final
git add -A
git commit -m "docs: informe final, exposición, diagramas C4, modelos y capturas según la implementación"
git push -u origin docs/informe-final
```
Y abrir el Pull Request hacia `main`.

## Pendiente antes de entregar
- Completar la fecha de la portada del informe (`__/__/2026`) y actualizar el índice en Word (clic derecho → Actualizar campos).
