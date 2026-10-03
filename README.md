# landing

Landing educativa de la clase gratuita **Bots MEV y arbitraje sin tecnicismos**.

- `index.html`: la página completa, en HTML estático sin dependencias.
- `media/`: video explicativo, guía en PDF, imagen de portada e icono.

## Configuración

En el script del final de `index.html`:

- `WHATSAPP_URL`: enlace al grupo de la comunidad.
- `WEBHOOK_URL`: URL pública del CRM (`https://tu-crm.com/api/leads`). Si se deja vacía, los registros no se guardan.

## Despliegue

Vercel la publica como sitio estático: no necesita build ni framework. Cada `git push` a `main` vuelve a desplegarla.
