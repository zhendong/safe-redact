# Safe Redact

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-blue)](https://reactjs.org/)

A privacy-focused document redaction tool that automatically detects and redacts sensitive information from PDF and DOCX documents.

**🔒 100% Local Processing** • **🚀 No Server Required** • **🎯 Smart Detection** • **🛡️ Privacy First**

## ✨ Features

### 🔍 Smart Detection
- **Automatic Detection**: Uses regex patterns and ML-based detection to find sensitive information
- **Multiple Detection Methods**: Combines pattern matching with machine learning for high accuracy
- **Customizable Patterns**: Add your own predefined words and custom detection rules
- **Language Support**: Detects content in multiple languages (Latin, Chinese, Arabic, etc.)

### 📄 Format Support
- **PDF Files**: Full support for text-based PDFs
- **DOCX Files**: Microsoft Word document support
- **Metadata Extraction**: View and remove document metadata and hidden content
- **Image Extraction**: Extract and download embedded images from documents

### 🎨 User Experience
- **Interactive Review**: Review and confirm detected entities before redaction
- **Manual Selection**: Click and drag to manually select sensitive areas
- **Bulk Operations**: Confirm or reject multiple entities at once
- **Real-time Preview**: See exactly what will be redacted

### 🔒 Privacy & Security
- **100% Local Processing**: All processing happens in your browser
- **No Server Required**: No data is sent to external servers
- **No Tracking**: No analytics or telemetry
- **Open Source**: Fully auditable code

## Data Types Detected

Safe Redact automatically detects the following types of sensitive information in both PDF and DOCX documents:

### Personal Identifiers

- **Social Security Numbers (SSN)**: US Social Security Numbers in various formats
- **Email Addresses**: RFC 5322 compliant email addresses
- **Phone Numbers**:
  - US phone numbers (various formats)
  - International phone numbers
  - China mobile numbers (11-digit format)
  - China landline numbers

### Financial Information

- **Credit Card Numbers**:
  - Generic credit cards (13-19 digits with Luhn validation)
  - Visa cards (13 or 16 digits)
  - Mastercard (16 digits)
  - American Express (15 digits)
  - Discover cards
  - China UnionPay cards

### Dates

- MM/DD/YYYY format
- YYYY-MM-DD format
- Month DD, YYYY format
- Chinese date format (YYYY年MM月DD日)
- DD/MM/YYYY format (International)

### Additional Data Types (Custom)

- **Chinese National ID**: 18-digit ID with validation
- **Passports**:
  - Chinese Passport (current and legacy formats)
  - US Passport
- **Network Information**:
  - IPv4 addresses
  - IPv6 addresses
  - URLs (HTTP/HTTPS)
- **Cryptocurrency**: Bitcoin addresses
- **Custom Predefined Words**: User-defined sensitive terms

## Document Sanitization

When the "Sanitize Document" option is enabled, Safe Redact removes metadata and hidden content to prevent information leakage.

### PDF Sanitization

The following elements are removed from PDF documents:

**Metadata**:

- Title, Author, Subject, Keywords
- Creator, Producer
- Creation Date, Modification Date
- All other metadata fields

**Hidden Content**:

- Comments and annotations (all types)
- Markup annotations (highlights, underlines, strikeouts, etc.)
- Stamps and file attachments
- Multimedia content (sound, video)
- Form fields (optional)
- Embedded files
- JavaScript actions
- Optional Content Groups (PDF layers)

### DOCX Sanitization

The following elements are removed from DOCX documents:

**Metadata**:

- Core Properties: Title, Author, Subject, Keywords, Creator, Last Modified By, Dates, Category, Content Status
- App Properties: Application name, Version, Company, Manager, Template
- Custom Properties: All custom metadata

**Hidden Content**:

- Comments and comment references
- Track Changes/Revisions (insertions, deletions, moves, formatting changes)
- Bookmarks
- Custom XML data
- Document Settings: Revision identifiers (RSIDs), proof errors, document protection
- VBA/Macros and macro data
- (Optional) Headers and footers
- (Optional) Embedded objects and files

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/zhendong/safe-redact.git
cd safe-redact
```

2. Install dependencies:
```bash
npm install
```

### Development

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Build

Build for production:
```bash
npm run build
```

The built files will be in the `dist/` directory.

### Testing

Run the test suite:
```bash
npm test
```

## 🛠️ Technology Stack

- **React 19 + TypeScript**: UI framework with type safety
- **Vite**: Fast build tool and dev server
- **MuPDF**: PDF parsing, rendering, and manipulation
- **PizZip + Mammoth**: DOCX processing
- **Transformers.js**: ML-based entity detection (optional)
- **Tailwind CSS**: Utility-first styling

## Privacy & Security

- All document processing happens **100% locally** in your browser
- No data is sent to external servers
- Documents never leave your device
- Open source and auditable

## 🤝 Contributing

Contributions are welcome!

### Ways to Contribute
- Report bugs and issues
- Suggest new features
- Improve documentation
- Submit pull requests
- Add test cases

## License

MIT License - see [LICENSE](LICENSE) file for details
