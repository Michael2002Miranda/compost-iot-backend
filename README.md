# Compost IoT · Backend

API REST del sistema de monitoreo de compostaje con IoT (El Porvenir, 2026).
Recibe las lecturas del **ESP32**, las clasifica, genera alertas y las entrega a la
aplicación móvil.

- **Node.js 20+** · Express 5 · PostgreSQL (Supabase)
- Autenticación propia con `scrypt` + token firmado (HMAC-SHA256), sin dependencias extra
- **30 pruebas automatizadas** (`npm test`)

---

## 1. Puesta en marcha

```bash
npm install
cp .env.example .env      # completar con los datos de Supabase
npm start                 # http://localhost:3000
npm test                  # pruebas
```

### Base de datos

El backend aplica `db/schema.sql` **automáticamente al arrancar** (ver `src/migrar.js`),
así que las tablas se crean solas en el primer despliegue. El script es idempotente:
conserva los registros existentes de `mediciones`.

Para desactivarlo, definir `AUTO_MIGRAR=false` y ejecutar el script a mano en el
**SQL Editor de Supabase** (o `psql -f db/schema.sql`).

Crea: `usuarios`, `composteras`, `mediciones`, `alertas`, `registros_ppfm`,
`registros_cfc`, `evaluaciones_sus`, `pruebas_funcionalidad` y la vista
`v_mediciones_grupo`.

### Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | sí | Conexión a Supabase |
| `DB_SSL` | no | `false` solo para una base local |
| `JWT_SECRET` | sí en producción | Firma de los tokens de sesión |
| `DEVICE_API_KEY` | recomendada | Clave que debe enviar el ESP32 en `x-api-key` |
| `PORT` | no | 3000 por defecto |

---

## 2. Despliegue en Render

1. Conectar el repositorio (ya está hecho).
2. **Environment → Add Environment Variable**: `JWT_SECRET` (cadena larga y aleatoria),
   `DEVICE_API_KEY` y las variables `DB_*`.
3. Build command: `npm install` · Start command: `npm start`.
4. Health check: `/health`.

---

## 3. Endpoints

### Públicos

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/health` | Estado del servicio y de la base |
| `GET` | `/` | Mensaje y total de mediciones |
| `POST` | `/api/auth/registro` | Crear cuenta `{nombre, email, password}` |
| `POST` | `/api/auth/login` | Iniciar sesión `{email, password}` |
| `POST` | `/api/mediciones` | **Ingesta del ESP32** (requiere `x-api-key` si está configurada) |

### Con sesión (`Authorization: Bearer <token>`)

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/auth/perfil` | Datos del usuario |
| `GET` `POST` | `/api/composteras` | Listar / registrar compostera (genera `codigo`) |
| `PATCH` | `/api/composteras/:id` | Renombrar o desactivar |
| `GET` | `/api/mediciones` | Historial filtrable (`compostera`, `desde`, `hasta`, `limit`) |
| `GET` | `/api/mediciones/ultima` | Última lectura + clasificación |
| `GET` | `/api/alertas` | Alertas (`estado=pendientes`) |
| `PATCH` | `/api/alertas/:id` | Marcar como atendida |
| `POST` `GET` | `/api/registros/ppfm` | Precisión de los parámetros medidos |
| `POST` `GET` | `/api/registros/cfc` | Calidad física del compost |
| `GET` | `/api/comparacion` | Promedios GC vs GE |
| `GET` | `/api/resumen` | Lecturas y alertas por compostera |
| `POST` | `/api/evaluaciones/sus` | Cuestionario de usabilidad |
| `POST` | `/api/pruebas/funcionalidad` | Casos de prueba |
| `GET` | `/api/export/mediciones.csv` | Exportación para el análisis estadístico |

---

## 4. Ingesta desde el ESP32

```bash
curl -X POST https://compost-iot-backend.onrender.com/api/mediciones \
  -H "Content-Type: application/json" \
  -H "x-api-key: TU_CLAVE" \
  -d '{"codigo_dispositivo":"CMP-4F2A","temperatura":52.3,"humedad":61.0,"ph":7.1,"ph_simulado":true}'
```

Respuesta:

```json
{
  "status": "success",
  "data": { "id": 128, "id_compostera": 3, "temperatura": "52.30", "humedad": "61.00", "ph": "7.10" },
  "clasificacion": {
    "fase": { "codigo": "termofila", "fase": "Fase termófila" },
    "estado": "optimo",
    "parametros": [ ... ]
  },
  "alertas": []
}
```

El dispositivo puede identificarse de dos formas:

- `codigo_dispositivo` (recomendado): el código que la app muestra al registrar la compostera.
- `id_compostera`: identificador numérico, se conserva por compatibilidad con el firmware anterior.

---

## 5. Reglas del dominio

| Parámetro | Rangos |
|---|---|
| Temperatura | < 15 crítica · 15–20 atención · 20–45 mesófila · 45–65 termófila · 65–70 atención · > 70 crítica |
| Humedad | < 40 crítica · 40–50 atención · 50–70 óptima · 70–80 atención · > 80 crítica |
| pH | < 5.0 crítico · 5.0–6.0 atención · 6.0–8.5 óptimo · 8.5–9.0 atención · > 9.0 crítico |

- **Fase:** se determina por temperatura y se corrobora con humedad y pH.
- **PPFM:** `100 − (|VM − VR| / VR) × 100`, acotado a [0, 100].
- **CFC:** suma de color, aroma, textura y humedad al tacto (0–8); maduro con 7 u 8.

Los umbrales están en `src/domain/clasificacion.js` y replicados en la app
(`lib/clasificacion.dart`). **Si se cambia uno, debe cambiarse el otro.**

---

## 6. Estructura

```
src/
  app.js                    rutas y manejo de errores (fábrica testeable)
  index.js                  arranque y cierre ordenado
  auth.js                   hash de contraseñas y tokens
  validacion.js             validación de cuerpos y filtros
  domain/clasificacion.js   PFC: rangos, fase y alertas
  domain/precision.js       PPFM
  db.js                     pool de PostgreSQL
db/schema.sql               esquema completo
firmware/esp32_compost_iot.ino
test/                       30 pruebas (node:test)
```
