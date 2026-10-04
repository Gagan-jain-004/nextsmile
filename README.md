# 🦷 Home of Smiles — Modern Dental Clinic Management & Patient Portal

A full-stack web application designed for **Home of Smiles Clinic**, providing a streamlined patient self-registration portal, comprehensive doctor admin dashboard, electronic dental records (EDR), orthodontic aligner tracking, and secure direct-to-cloud media management.

---

## ✨ Features

### 👤 Patient Self-Registration Portal (`/register`)
- **Quick Digital Check-in**: Intuitive digital intake form for incoming and returning patients.
- **Smart Date of Birth & Age Calculator**: Automatic age computation from entered birth dates.
- **Chief Complaint & Medical History Chips**: One-tap quick selection for common dental issues and medical conditions (Diabetes, Hypertension, Allergies, etc.).
- **Instant Token Badge**: Generates a real-time token badge and patient ID for clinic visit tracking.

### 🩺 Doctor Admin Portal (`/doctoradmin`)
- **Secure Authentication**: Protected doctor dashboard secured via JWT (JSON Web Tokens) with credential verification.
- **Patient Queue & Electronic Records**: Real-time management of patient queue, case histories, treatment notes, and dental charts.
- **Orthodontic Aligner Module**: Built-in interactive aligner treatment tracker and stage simulator.
- **Direct-to-Cloud Media Storage**: High-speed, secure image and X-ray upload pipeline integrated with Cloudinary via backend-signed upload requests.
- **Database Backup & Sync**: Live data persistence to MongoDB Atlas with auto-sync and local offline caching capabilities.

### ⚡ Backend & API Architecture
- **RESTful API Routes** built on Next.js 14 App Router:
  - `POST /api/register-patient` — Processes new patient registrations.
  - `POST /api/doctor-login` — Authenticates doctors and issues session tokens.
  - `GET /api/get-data` — Retrieves patient lists and treatment records.
  - `POST /api/save-data` — Saves updated clinical notes and treatment progress.
  - `POST /api/sign-cloudinary` — Generates cryptographic signatures for secure frontend media uploads.
  - `GET /api/system-status` — Health check endpoint for system monitoring.

---

## 🛠️ Tech Stack

- **Framework**: [Next.js 14 (App Router)](https://nextjs.org/)
- **Frontend**: [React 18](https://react.dev/), Vanilla CSS (Responsive & Mobile-optimized)
- **Database**: [MongoDB Atlas](https://www.mongodb.com/atlas) with native Node.js driver
- **Cloud Storage**: [Cloudinary](https://cloudinary.com/) (Intraoral photos, X-rays, clinical documents)
- **Authentication**: JWT (`jsonwebtoken`)
- **Deployment Target**: Vercel / Node.js Server

---

## 📁 Project Structure

```text
httmcode/
├── public/                     # Static assets and icons
├── src/
│   ├── app/
│   │   ├── api/                # Next.js Serverless API endpoints
│   │   │   ├── doctor-login/
│   │   │   ├── get-data/
│   │   │   ├── register-patient/
│   │   │   ├── save-data/
│   │   │   ├── sign-cloudinary/
│   │   │   └── system-status/
│   │   ├── doctoradmin/        # Doctor Admin Dashboard page
│   │   ├── register/           # Patient self-registration page
│   │   ├── globals.css         # Global stylesheets & design system
│   │   ├── layout.js           # Root layout configuration
│   │   └── page.js             # Root redirect to /register
│   ├── components/             # Reusable UI & Clinic dashboard modules
│   │   ├── ClinicApp.js
│   │   └── clinicHtml.js
│   └── lib/                    # Shared helper libraries (DB, Auth)
│       ├── auth.js
│       └── db.js
├── aligner_v2_module.js        # Orthodontic aligner computation module
├── apply_aligner.js            # Aligner logic utilities
├── .env.sample                 # Sample environment variables
├── next.config.mjs             # Next.js configuration
├── package.json                # Project dependencies and scripts
└── vercel.json                 # Vercel deployment configuration
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: `v18.17.0` or higher
- **npm** or **yarn** / **pnpm**
- A **MongoDB Atlas** database cluster
- A **Cloudinary** account

### 2. Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/Gagan-jain-004/nextsmile.git
cd nextsmile
npm install
```

### 3. Environment Variables Configuration

Create a `.env.local` file in the root directory by copying the provided sample:

```bash
cp .env.sample .env.local
```

Populate the configuration values:

```env
# Doctor Admin Portal Credentials
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password

# JWT Session Secret
JWT_SECRET=your_long_random_jwt_secret_key

# MongoDB Connection
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/HomeOfSmilesDB?retryWrites=true&w=majority

# Cloudinary Credentials
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

### 4. Running the Application

Run the development server:

```bash
npm run dev
```

Open your browser and navigate to:
- **Patient Registration**: [http://localhost:3000/register](http://localhost:3000/register)
- **Doctor Portal**: [http://localhost:3000/doctoradmin](http://localhost:3000/doctoradmin)

---

## 📦 Production Build

To create an optimized production build:

```bash
npm run build
npm run start
```

---

## 🔒 Security Best Practices

- All administrative routes and data modification APIs verify JWT session tokens.
- Cloudinary direct uploads require backend-signed timestamps and SHA-1/SHA-256 signatures, preventing unauthorized bucket writes.
- Database credentials and secrets are kept strictly on the server side via environment variables.

---

## 📄 License

Private & Proprietary — Developed for **Home of Smiles Dental Clinic**.
