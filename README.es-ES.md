

# Safe Redact

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://reactjs.org/)

Inglés | [简体中文](README.zh-CN.md)

Una herramienta de enmascaramiento de documentos centrada en la privacidad que detecta y oculta automáticamente información sensible de documentos PDF y DOCX.

**🔒 Procesamiento 100% Local** • **🚀 Sin Servidor Requerido** • **🎯 Detección Inteligente** • **🛡️ Privacidad Primero**

## 🆕 Nuevas Funcionalidades y Correcciones

- **Soporte para el idioma chino**: Traducción completa de la interfaz de usuario con un interruptor de idioma de un solo clic en la cabecera, detectado automáticamente desde la configuración regional de su navegador y recordado entre sesiones
- **Visor de imágenes (lightbox)**: Vista previa de imágenes extraídas de documentos a tamaño completo directamente en el modal de revisión de metadatos, con navegación anterior/siguiente, una barra de miniaturas y atajos de teclado (flechas, Escape)
- **Revisión de entidades más fiable**: Corregido el estado de selección inconsistente al confirmar/rechazar entidades detectadas, y eliminado el estado confuso de pendiente/modificado

## ✨ Funcionalidades

### 🔍 Detección Inteligente
- **Detección automática**: Utiliza patrones de expresión regular y detección basada en ML para encontrar información sensible
- **Múltiples métodos de detección**: Combina la coincidencia de patrones con el aprendizaje automático para una alta precisión
- **Patrones personalizables**: Agrega tus propias palabras predefinidas y reglas de detección personalizadas
- **Soporte de idiomas**: Detecta contenido en múltiples idiomas (latino, chino, árabe, etc.)

### 📄 Soporte de Formatos
- **Archivos PDF**: Soporte completo para PDFs basados en texto
- **Archivos DOCX**: Soporte para documentos de Microsoft Word
- **Extracción de metadatos**: Visualiza y elimina metadatos de documentos y contenido oculto
- **Extracción de imágenes**: Extrae y descarga imágenes incrustadas de los documentos

### 🎨 Experiencia de Usuario
- **Revisión interactiva**: Revisa y confirma las entidades detectadas antes de enmascarar
- **Selección manual**: Haz clic y arrastra para seleccionar manualmente áreas sensibles
- **Operaciones en masa**: Confirma o rechaza múltiples entidades a la vez
- **Vista previa en tiempo real**: Ve exactamente qué se enmascarará

### 🔒 Privacidad y Seguridad
- **Procesamiento 100% local**: Todo el procesamiento ocurre en tu navegador
- **Sin servidor requerido**: Ningún dato se envía a servidores externos
- **Sin rastreo**: Sin análisis ni telemetría
- **Código abierto**: Código totalmente auditable

## Tipos de Datos Detectados

Safe Redact detecta automáticamente los siguientes tipos de información sensible en documentos PDF y DOCX:

### Identificadores Personales

- **Números de Seguro Social (SSN)**: Números de Seguro Social de EE. UU. en varios formatos
- **Direcciones de correo electrónico**: Direcciones de correo electrónico compatibles con RFC 5322
- **Números de teléfono**:
  - Números de teléfono de EE. UU. (varios formatos)
  - Números de teléfono internacionales
  - Números de móviles de China (formato de 11 dígitos)
  - Números de línea fija de China

### Información Financiera

- **Números de tarjetas de crédito**:
  - Tarjetas de crédito genéricas (13-19 dígitos con validación de Luhn)
  - Tarjetas Visa (13 o 16 dígitos)
  - Mastercard (16 dígitos)
  - American Express (15 dígitos)
  - Tarjetas Discover
  - Tarjetas UnionPay de China

### Fechas

- Formato MM/DD/YYYY
- Formato YYYY-MM-DD
- Formato Mes DD, YYYY
- Formato de fecha chino (YYYY年MM月DD日)
- Formato DD/MM/YYYY (Internacional)

### Tipos de Datos Adicionales (Personalizados)

- **Documento Nacional de Identidad de China**: ID de 18 dígitos con validación
- **Pasaportes**:
  - Pasaporte de China (formatos actuales y antiguos)
  - Pasaporte de EE. UU.
- **Información de red**:
  - Direcciones IPv4
  - Direcciones IPv6
  - URLs (HTTP/HTTPS)
- **Criptomonedas**: Direcciones Bitcoin
- **Palabras predefinidas personalizadas**: Términos sensibles definidos por el usuario

## Sanitización de Documentos

Cuando la opción "Sanitizar documento" está habilitada, Safe Redact elimina metadatos y contenido oculto para evitar filtraciones de información.

### Sanitización de PDF

Los siguientes elementos se eliminan de los documentos PDF:

**Metadatos**:

- Título, Autor, Asunto, Palabras clave
- Creador, Productor
- Fecha de creación, Fecha de modificación
- Todos los demás campos de metadatos

**Contenido oculto**:

- Comentarios y anotaciones (todos los tipos)
- Anotaciones de marcado (resaltados, subrayados, tachados, etc.)
- Sellos y archivos adjuntos
- Contenido multimedia (audio, video)
- Campos de formulario (opcional)
- Archivos incrustados
- Acciones JavaScript
- Grupos de contenido opcional (capas PDF)

### Sanitización de DOCX

Los siguientes elementos se eliminan de los documentos DOCX:

**Metadatos**:

- Propiedades básicas: Título, Autor, Asunto, Palabras clave, Creador, Última modificación por, Fechas, Categoría, Estado del contenido
- Propiedades de la aplicación: Nombre de la aplicación, Versión, Empresa, Administrador, Plantilla
- Propiedades personalizadas: Todos los metadatos personalizados

**Contenido oculto**:

- Comentarios y referencias a comentarios
- Seguimiento de cambios/revisiones (inserciones, eliminaciones, movimientos, cambios de formato)
- Marcadores
- Datos XML personalizados
- Configuración del documento: Identificadores de revisión (RSIDs), errores de ortografía, protección del documento
- VBA/Macros y datos de macros
- (Opcional) Cabeceras y pies de página
- (Opcional) Objetos y archivos incrustados

## 🚀 Primeros Pasos

### Requisitos previos

- Node.js 18 o superior
- npm o yarn

### Instalación

1. Clona el repositorio:
```bash
git clone https://github.com/zhendong/safe-redact.git
cd safe-redact
```

2. Instala las dependencias:
```bash
npm install
```

### Desarrollo

Inicia el servidor de desarrollo:
```bash
npm run dev
```

La aplicación estará disponible en `http://localhost:5173`

### Compilación

Compila para producción:
```bash
npm run build
```

Los archivos compilados estarán en el directorio `dist/`.

### Pruebas

Ejecuta el conjunto de pruebas:
```bash
npm test
```

## 🛠️ Pila Tecnológica

- **React 19 + TypeScript**: Marco de trabajo de interfaz de usuario con seguridad de tipos
- **Vite**: Herramienta de compilación rápida y servidor de desarrollo
- **MuPDF**: Análisis, renderizado y manipulación de PDFs
- **PizZip + Mammoth**: Procesamiento de DOCX
- **Transformers.js**: Detección de entidades basada en ML (opcional)
- **Tailwind CSS**: Estilos utility-first

## Privacidad y Seguridad

- Todo el procesamiento de documentos ocurre **100% localmente** en tu navegador
- Ningún dato se envía a servidores externos
- Los documentos nunca salen de tu dispositivo
- Código abierto y auditable

## 🤝 Contribución

¡Las contribuciones son bienvenidas!

### Formas de Contribuir
- Reporta errores y problemas
- Sugiere nuevas funcionalidades
- Mejora la documentación
- Envía pull requests
- Añade casos de prueba

## Licencia

Licencia MIT - consulta el archivo [LICENSE](LICENSE) para más detalles
