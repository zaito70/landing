# CRM de la clase gratuita

Recibe los registros de la landing, los muestra en un embudo por etapas y avisa a n8n de cada cambio para automatizar los seguimientos.

```
Landing (formulario) ──POST /api/leads──▶ CRM (Bun + SQLite) ──evento──▶ n8n
                                            │                          │
                                     panel en el navegador     email de bienvenida,
                                    (embudo, fichas, WhatsApp)  recordatorio a las 24 h
                                            ▲                          │
                                            └──── anota la actividad ◀─┘
```

## Arrancarlo

1. Doble clic en `iniciar-crm.bat`. La primera vez crea el archivo `.env`.
2. Abre `.env` y cambia `CRM_TOKEN` por una contraseña larga.
3. Vuelve a abrir `iniciar-crm.bat` y entra a **http://localhost:3010** con esa contraseña.

También puedes arrancarlo desde la terminal con `bun run server.ts`.

## Etapas del embudo

| Etapa | Cuándo mover el lead aquí |
|---|---|
| Nuevo | Se acaba de registrar (automático) |
| Contactado | Ya le escribiste por WhatsApp o lo llamaste |
| Asistió a la clase | Entró a la clase |
| Interesado | Pidió más información |
| Cliente | Compró o se inscribió |
| Perdido | No responde o no le interesa |

Para cambiar la etapa, arrastra la tarjeta a otra columna o cámbiala desde la ficha. En la ficha, el botón **Escribir por WhatsApp** abre el chat con un mensaje ya escrito y lo anota en el historial. Las tarjetas que llevan más de 24 horas en "Nuevo" se marcan en amarillo.

## Conectar n8n

1. En n8n: **Import from file** → `n8n/flujo-leads-clase.json`.
2. Crea dos credenciales:
   - **SMTP**: el correo desde el que se envían los emails.
   - **CRM token** (tipo *Header Auth*): nombre `Authorization`, valor `Bearer TU_CRM_TOKEN`.
3. En el nodo **Configuración**, pon tu correo de remitente y la dirección del CRM. Si n8n corre en Docker, usa `http://host.docker.internal:3010`.
4. Activa el flujo y copia la *Production URL* del nodo **Evento del CRM** en `N8N_WEBHOOK_URL` del archivo `.env`.
5. Reinicia el CRM. Arriba a la derecha del panel debe aparecer "n8n conectado".

El CRM envía a n8n estos eventos: `lead.created`, `lead.repeated` (alguien se registró de nuevo con el mismo email) y `lead.stage_changed`. El flujo de ejemplo usa `lead.created`; los otros dos están disponibles para nuevas automatizaciones.

## Publicarlo en Railway

Esta carpeta vive dentro del repo de la landing. Vercel la ignora (`.vercelignore`) y Railway la despliega con el `Dockerfile`.

1. En Railway: **New → GitHub Repo → landing**. En el servicio, **Settings → Root Directory** = `/crm`.
2. **Variables**: `DB_PATH=/data/crm.sqlite` (o no la definas: el Dockerfile ya la pone), `CRM_TOKEN` (contraseña larga), `ALLOWED_ORIGINS` (la URL de la landing en Vercel) y, cuando tengas n8n, `N8N_WEBHOOK_URL`.
3. **Volumen**: clic derecho en el servicio → *Attach volume*, con ruta de montaje `/data`. Ahí se guarda `crm.sqlite`; sin volumen, los leads se borran en cada despliegue.
4. **Settings → Networking → Generate Domain**. Pon esa URL + `/api/leads` en `WEBHOOK_URL` de `../index.html`.

## Correos desde Gmail (n8n)

Railway bloquea SMTP en los planes Free/Hobby, así que el flujo usa el nodo **Gmail** de n8n, que envía por la API de Google (HTTPS).

Credencial **Gmail OAuth2** en n8n para `risasazair@gmail.com`:

1. En https://console.cloud.google.com crea un proyecto y activa **Gmail API**.
2. **Pantalla de consentimiento de OAuth**: tipo *Externo*, añade `risasazair@gmail.com` como usuario de prueba y luego pulsa **Publicar app** (en modo prueba el acceso caduca a los 7 días).
3. **Credenciales → Crear ID de cliente OAuth** → *Aplicación web*, con URI de redirección `https://n8n-production-880a.up.railway.app/rest/oauth2-credential/callback`.
4. En n8n, credencial **Gmail OAuth2 API**: pega el Client ID y el Client Secret y pulsa **Sign in with Google**. Google avisará de que la app no está verificada: *Configuración avanzada → Ir a…* y acepta.

## Seguridad

- Solo el registro de leads es público. Todo lo demás exige la contraseña `CRM_TOKEN`.
- Cada conexión puede hacer como máximo 20 intentos de registro cada 10 minutos.
- El servidor descarta en silencio los envíos de bots que rellenan el campo oculto `website`. La landing todavía no incluye ese campo.
- Haz copias de seguridad de `crm.sqlite`: es tu lista de leads. También puedes exportarla a CSV desde el panel.
