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

## Producción

- Landing: https://landing-three-beta-35.vercel.app (Vercel, equipo zaito71, repo `zaito70/landing`)
- CRM: https://landing-production-4679.up.railway.app (Railway, carpeta `crm/`)
- n8n: https://n8n-production-880a.up.railway.app (Railway, servicio `n8n` con volumen en `/home/node/.n8n`). El CRM le avisa en `/webhook/crm-eventos`.
- Los commits deben salir con el email de la cuenta de Vercel (`zaito1170@gmail.com`); si no, Vercel bloquea el despliegue.
