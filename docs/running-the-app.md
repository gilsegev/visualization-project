# How to Run the Application

This guide provides step-by-step instructions to run the application locally.

## Prerequisites

1.  **Node.js**: Ensure Node.js (v18+ recommended) is installed.
2.  **Dependencies**: Run `npm install` to install project dependencies.
3.  **Environment Variables**:
    -   Ensure you have a `.env` file in the root directory.
    -   Required keys:
        -   `SILICONFLOW_API_KEY`: For image generation.
        -   `GEMINI_API_KEY`: For other AI features (if applicable).

## Running the App

### 1. Development Mode
To run the application in development mode with hot-reloading (app + CLIP scorer together):

```bash
npm run start:dev:with-clip
```

The application will start and listen on port 3000 (default).
Access it at: `http://localhost:3000`

This command also starts the CLIP scorer on port `4310`, required for sourced-image semantic scoring.

If you need app-only mode:

```bash
npm run start:dev
```

### 2. Production Mode
To build and run the optimized production version:

```bash
npm run build
npm run start:prod
```

### 3. Verification
You can check if the server is running by visiting the health check endpoint (if one exists) or simply the root URL.

## Image Generation
Generated images will appear in the `public/generated-images` directory.
