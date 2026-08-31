# WAYV MVP

Primera base modular de WAYV para ubicar amigos en festivales mediante dirección, distancia y precisión.

## Incluido

- inicio y recuperación de sesión local;
- creación de grupos con vencimiento en horas o días;
- ingreso mediante código privado;
- pantalla de espera y simulación de aprobación;
- selección de integrantes;
- flecha direccional e instrucciones de navegación;
- estados Live/Offline;
- estructura PWA instalable.
- sesiones anónimas persistentes mediante Supabase;
- solicitudes y aprobación real del creador;
- envío de ubicación en primer plano cada cinco segundos;
- políticas RLS que restringen los datos a integrantes aprobados.

## Ejecutar

La geolocalización y el service worker requieren HTTPS o un servidor local. Desde esta carpeta:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`.

## Conectar Supabase

1. Crea un proyecto gratuito en Supabase.
2. Activa `Anonymous Sign-Ins` en Authentication.
3. Abre SQL Editor y ejecuta `schema.sql`.
4. Copia la URL del proyecto y la `Publishable key` en `config.js`.
5. Sirve la carpeta mediante HTTPS o un servidor local.

Nunca pongas una `Secret key` o `service_role` en `config.js`.

Sin configuración, WAYV conserva el modo demostración. Con configuración, la creación, solicitudes, aprobación y sesión usan Supabase.
