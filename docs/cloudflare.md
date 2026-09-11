# BitNode en Cloudflare

## Producto elegido

Workers con Static Assets sirve el frontend React/Vite de `dist/public`.
El Worker envía `/api` y `/api/*` a `https://bit-node.vercel.app`, el origen
Vercel de BitNode comprobado durante la preparación. Se mantienen el backend
Express, las funciones Vercel y las integraciones de datos existentes.
Esta es una incorporación de Cloudflare al frontend, no una migración completa
del backend. Pages también aloja sitios estáticos; Workers permite controlar
explícitamente las rutas de API junto con los archivos del frontend.

No se requieren D1, KV, R2 ni Hyperdrive para esta primera configuración.
La configuración no incorpora dominios ni rutas DNS.

Validación local: compilación Vite, seis pruebas del proxy y dry-run de Wrangler
correctos. En el runtime local, `/` y `/dashboard` respondieron 200 con la SPA;
`/api/commissions/summary` respondió 401 JSON sin sesión, con `Cache-Control:
no-store`, a través del origen real. No se probaron operaciones financieras.
El lanzador de Wrangler desactiva la carga automática de los archivos `.env`
del backend para sus comandos; Vite conserva su carga habitual al compilar.

## Herramientas y comandos

Wrangler 4.131.0 vive en `cloudflare/package.json`, con su propio lockfile npm.
Se aisló porque las dependencias existentes fueron instaladas con pnpm 11,
mientras que el proyecto declara pnpm 10.4.1. El lockfile principal se conserva.

Desde la raíz, en PowerShell:

```powershell
npm.cmd --prefix cloudflare ci
npm.cmd --prefix cloudflare run whoami
npm.cmd run cloudflare:check
npm.cmd --prefix cloudflare run test
npm.cmd run cloudflare:dev
```

La comprobación compila con Vite y ejecuta `wrangler deploy --dry-run`.
`cloudflare:dev` utiliza el runtime local de Workers. **Su API apunta a Vercel
producción**, al igual que el entorno staging: no es un entorno aislado para
probar pagos, retiros ni operaciones de escritura.

Los valores públicos `VITE_*` se incorporan durante la compilación de Vite.
Un entorno de compilación nuevo necesita las mismas variables públicas que el
frontend actual. No poner claves privadas en `VITE_*`, en `dist/public` ni en
Wrangler. Los secretos del backend permanecen en su proveedor actual.

## Autenticación y publicación

Durante la preparación, `whoami` indicó que Wrangler no estaba autenticado.
Completar el acceso personalmente:

```powershell
& .\cloudflare\node_modules\.bin\wrangler.cmd login
npm.cmd --prefix cloudflare run whoami
```

Tras verificar la cuenta y el nombre del Worker de destino:

```powershell
npm.cmd run cloudflare:deploy:staging
# Publica bitnode-staging en workers.dev.

npm.cmd run cloudflare:deploy:production
# Publica bitnode en workers.dev.
```

Si hay varias cuentas, seleccionar la correcta y definir `CLOUDFLARE_ACCOUNT_ID`
en la sesión o el entorno de despliegue. No se fijó una cuenta sin verificarla.
Los nombres anteriores son destinos propuestos; aún no se comprobó si existen.

Antes de usar una URL nueva con usuarios, comprobar login y rutas profundas,
las URLs permitidas de autenticación y los enlaces de retorno del backend.
La conservación de cookies y las redirecciones del proxy se probaron con mocks;
el login real y el comportamiento del límite por IP a través de Vercel requieren
verificación en el dominio desplegado.

## MCP de Cloudflare

El plugin instalado declara `cloudflare-api` con el servidor oficial:

```json
{
  "mcpServers": {
    "cloudflare-api": { "url": "https://mcp.cloudflare.com/mcp" }
  }
}
```

En esta tarea no se expusieron sus herramientas `search` y `execute`.
Conectar/autenticar el MCP del plugin mediante OAuth y seleccionar la cuenta y
los permisos que se desean conceder. La autenticación MCP y `wrangler login`
son independientes. No compartir tokens en el chat.

Para una instalación CLI que no cargue el MCP del plugin, la alternativa es:

```powershell
codex.cmd mcp add cloudflare-api --url https://mcp.cloudflare.com/mcp
codex.cmd mcp login cloudflare-api
```

No agregar una entrada duplicada si el cliente ya carga el servidor del plugin.
Una vez conectado, usar `search` para localizar los endpoints de listado de
cuentas, Workers y despliegues; usar `execute` primero solo para consultarlos.
Verificar cuenta y posible Worker existente antes de desplegar. La publicación
de este repositorio se realiza con Wrangler, que empaqueta código y assets.

## Referencias

- [Workers: React y Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [Static Assets y rutas de API](https://developers.cloudflare.com/workers/static-assets/binding/)
- [MCP oficial de Cloudflare](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/)
