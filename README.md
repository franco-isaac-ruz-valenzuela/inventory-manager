<p align="center">
  <img src="public/logo.jpg" alt="LEKER Logo" width="100" style="border-radius: 16px;" />
</p>

<h1 align="center">LEKER — Sistema de Gestión y Control de Inventarios</h1>

<p align="center">
  <strong>Plataforma web integral para la administración, auditoría y control de inventarios en tiempo real con sincronización en la nube, conciliación de planillas Excel y escaneo de códigos de barras.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-16.4-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Firebase-Firestore-FFA611?style=for-the-badge&logo=firebase" alt="Firebase" />
  <img src="https://img.shields.io/badge/Bootstrap_Icons-1.11-7952B3?style=for-the-badge&logo=bootstrap" alt="Bootstrap Icons" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License MIT" />
</p>

---

## Documentación del sistema

La documentación completa está en [docs/README.md](docs/README.md): manual de uso,
administración, arquitectura y datos, despliegue, operación y recuperación,
pruebas, privacidad y ampliación nacional. Consultar también el
[registro de cambios](CHANGELOG.md) y [seguridad](SECURITY.md).

El alcance actual es el control interno de materiales de una bodega: no emite
documentos tributarios ni reemplaza la contabilidad. No hay separación por bodega
ni respaldos automáticos configurados. Los límites operativos están documentados.

## 🌟 Características Principales

### 📦 Gestión de Inventario Completa
* **CRUD en tiempo real:** Creación, edición, consulta y eliminación de productos sincronizados al instante mediante Cloud Firestore.
* **Ajuste rápido de existencias:** Botones interactivos para incremento o descuento inmediato de unidades.
* **Búsqueda instantánea:** Filtrado ágil por código SKU o nombre de producto.
* **Exportación:** Descarga de reportes completos a planillas Excel (`.xlsx`).

### 📤 Importación y Conciliación Inteligente de Excel
* **Carga masiva directa:** Sube planillas `.xlsx`, `.xls` o `.csv` para poblar el inventario en segundos.
* **Detección automática de columnas:** Mapeo inteligente de encabezados (SKU, Descripción, Cantidad/Stock).
* **Modos de importación flexibles:**
  * *Actualizar y agregar nuevos:* Sincroniza stocks de productos existentes y da de alta los nuevos.
  * *Solo agregar nuevos:* Respeta las existencias actuales e ingresa únicamente los ítems faltantes.
  * *Reemplazo total:* Reinicia el inventario con los datos del archivo importado.
* **Módulo de comparación:** Cruce y auditoría entre planillas de bodega vs. stock registrado con diferenciación por colores (faltantes, sobrantes y coincidencias).

### 📷 Escáner de Códigos de Barra y SKU
* **Lectura mediante cámara:** Compatible con cámaras web y dispositivos móviles para escaneo ágil en bodega.
* **Búsqueda manual:** Opción para ingresar códigos manualmente.
* **Deducción y reposición inmediata:** Descuenta o suma unidades en tiempo real con un solo toque.

### 🔔 Notificaciones y Auditoría Colaborativa
* **Alertas en vivo:** Notificaciones inmediatas en la interfaz web cuando cualquier usuario realiza un descuento o ajuste de stock.
* **Historial de trazabilidad (Audit Log):** Registro inmutable de cada acción realizada en la plataforma (quién agregó, editó, eliminó o escaneó, con fecha, hora exacta y valores previos/posteriores).

---

## 🛠️ Tecnologías Utilizadas

* **Frontend:** [Next.js 16](https://nextjs.org/) (React, App Router, Server Components & Client Hooks)
* **Estilos:** Vanilla CSS con Dark Mode premium, Glassmorphism y diseño responsivo.
* **Íconos:** [Bootstrap Icons](https://icons.getbootstrap.com/)
* **Base de Datos & Auth:** [Google Firebase](https://firebase.google.com/) (Cloud Firestore & Authentication)
* **Procesamiento de Archivos:** [SheetJS / XLSX](https://sheetjs.com/)
* **Escaneo:** Componentes y librerías de cámara del proyecto, con búsqueda manual.

---

## 🚀 Instalación y Puesta en Marcha

Sigue estos sencillos pasos para ejecutar el proyecto en tu entorno local:

### 1. Clonar el repositorio
```bash
git clone URL_DEL_REPOSITORIO
cd inventory-manager
```

### 2. Instalar dependencias
```bash
npm ci
```

### 3. Configurar variables de entorno
Crea un archivo `.env.local` en la raíz del proyecto tomando como referencia el archivo `.env.example`:

```bash
cp .env.example .env.local
```

Rellena los valores con las credenciales de tu proyecto en [Firebase Console](https://console.firebase.google.com/):

```env
NEXT_PUBLIC_FIREBASE_API_KEY=tu_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=tu_proyecto.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=tu_proyecto
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=tu_proyecto.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

### 4. Iniciar el servidor de desarrollo
```bash
npm run dev
```

El entorno usado durante esta revisión funciona con `npm.cmd run dev -- --port 3001`.
Localhost usa el proyecto Firebase configurado; no implica una base de datos aislada.
Consultar [instalación y despliegue](docs/DESPLIEGUE.md) para requisitos, variables,
pruebas y publicación separada de reglas.

---

## 🌐 Despliegue en Producción (Vercel)

Este proyecto está optimizado para desplegarse con un solo clic en **Vercel**:

1. Sube tu código a GitHub.
2. Ingresa a [Vercel](https://vercel.com/) e importa este repositorio.
3. En la sección **Environment Variables**, añade las mismas variables que configuraste en tu `.env.local`.
4. Haz clic en **Deploy**.

---

## 📄 Licencia

Este proyecto está bajo la Licencia **MIT** — consulta el archivo [LICENSE](LICENSE) para más detalles.

---

<p align="center">
  Sistema de gestión interna de materiales de bodega
</p>
