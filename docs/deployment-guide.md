# Deployment Guide

This guide covers different deployment options for the in-browser LLM inference application.

## Prerequisites

- Node.js 18+ and pnpm 8+
- Git repository with GitHub Actions enabled (for GitHub Pages)
- Build environment with sufficient storage for model downloads

## Deployment Type Configuration

This application supports two deployment modes:

1. **GitHub Pages (Default)**: Deployed to `https://username.github.io/repository-name/`
2. **Standalone Domain**: Deployed to custom domains like `https://mydomain.com/`

### Switching Between Deployment Types

**For GitHub Pages (Default):**
```bash
# Build for GitHub Pages (default)
pnpm run build

# Or explicitly set environment variable
DEPLOYMENT_TYPE=github-pages pnpm run build
```

**For Standalone Domain:**
```bash
# Build for standalone domain
DEPLOYMENT_TYPE=standalone pnpm run build
```

**Configuration Files:**
- Update `DEPLOYMENT_TYPE` in `src/lib/constants.js` for runtime configuration
- Update `STANDALONE_DOMAIN` in `src/lib/constants.js` if using a custom domain
- The embed script automatically detects the deployment type based on the domain

## GitHub Pages Deployment (Default)

### Automatic Deployment

1. **Setup GitHub Repository**
   ```bash
   # Push your code to GitHub
   git remote add origin https://github.com/username/repository-name.git
   git push -u origin main
   ```

2. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Source: "Deploy from a branch" 
   - Branch: "gh-pages" (will be created automatically)

3. **Deploy to Production**
   ```bash
   # Switch to release branch
   git checkout release/prod
   
   # Push to trigger deployment
   git push origin release/prod
   ```

The workflow will:
- Install dependencies with model download skipped
- Download production models
- Build the application and embed script
- Deploy to GitHub Pages at: `https://username.github.io/repository-name/`

### Manual GitHub Pages Setup

If automatic deployment doesn't work:

```bash
# Build locally
pnpm run build

# Deploy using gh-pages (install if needed)
npx gh-pages -d dist
```

## Custom Domain Deployment

### Netlify

1. **Build Settings**
   - Build command: `pnpm run build`
   - Publish directory: `dist`
   - Node version: `18`

2. **Environment Variables**
   ```
   SKIP_DOWNLOAD_MODEL=false
   ```

3. **Headers (important for WebAssembly)**
   Create `public/_headers`:
   ```
   /*
     Cross-Origin-Embedder-Policy: require-corp
     Cross-Origin-Opener-Policy: same-origin
   ```

### Vercel

1. **Build Configuration** (vercel.json)
   ```json
   {
     "buildCommand": "pnpm run build",
     "outputDirectory": "dist",
     "installCommand": "pnpm install",
     "framework": null
   }
   ```

2. **Headers Configuration**
   ```json
   {
     "headers": [
       {
         "source": "/(.*)",
         "headers": [
           {
             "key": "Cross-Origin-Embedder-Policy",
             "value": "require-corp"
           },
           {
             "key": "Cross-Origin-Opener-Policy", 
             "value": "same-origin"
           }
         ]
       }
     ]
   }
   ```

### Apache Server

Create `.htaccess` in root:
```apache
Header always set Cross-Origin-Embedder-Policy require-corp
Header always set Cross-Origin-Opener-Policy same-origin

# Enable compression
<IfModule mod_deflate.c>
    AddOutputFilterByType DEFLATE text/plain text/html text/css text/javascript application/javascript application/wasm
</IfModule>

# Cache static assets
<IfModule mod_expires.c>
    ExpiresActive On
    ExpiresByType application/wasm "access plus 1 month"
    ExpiresByType application/javascript "access plus 1 week"
</IfModule>
```

### Nginx

Add to server config:
```nginx
server {
    location / {
        add_header Cross-Origin-Embedder-Policy require-corp;
        add_header Cross-Origin-Opener-Policy same-origin;
        
        # Cache WebAssembly files
        location ~* \.(wasm)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }
}
```

## Self-Hosted Deployment

### Docker Deployment

1. **Create Dockerfile**
   ```dockerfile
   FROM node:18-alpine
   
   WORKDIR /app
   COPY package.json pnpm-lock.yaml ./
   RUN npm install -g pnpm && pnpm install --frozen-lockfile
   
   COPY . .
   RUN pnpm run build
   
   FROM nginx:alpine
   COPY --from=0 /app/dist /usr/share/nginx/html
   COPY nginx.conf /etc/nginx/conf.d/default.conf
   
   EXPOSE 80
   ```

2. **nginx.conf**
   ```nginx
   server {
       listen 80;
       root /usr/share/nginx/html;
       index index.html;
       
       add_header Cross-Origin-Embedder-Policy require-corp;
       add_header Cross-Origin-Opener-Policy same-origin;
       
       location / {
           try_files $uri $uri/ /index.html;
       }
   }
   ```

3. **Build and Run**
   ```bash
   docker build -t browser-llm .
   docker run -p 8080:80 browser-llm
   ```

### Direct Server Deployment

```bash
# On your server
git clone https://github.com/username/repository-name.git
cd repository-name

# Install dependencies
pnpm install

# Build for production
pnpm run build

# Serve dist/ folder with your web server
# Make sure to set COOP/COEP headers!
```

## CDN Configuration

For optimal performance, configure CDN with:

1. **Caching Rules**
   - Static assets (JS/CSS): 7 days
   - WebAssembly files: 30 days
   - Models: 90 days (they rarely change)

2. **Compression**
   - Enable Gzip/Brotli for all text files
   - Special handling for .wasm files

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SKIP_DOWNLOAD_MODEL` | `false` | Skip automatic model download during install |
| `NODE_ENV` | `development` | Set to `production` for optimized builds |

## Troubleshooting

### Common Issues

1. **WebAssembly not loading**
   - Ensure COOP/COEP headers are set
   - Check browser console for security errors

2. **Models not downloading**
   - Check network connectivity
   - Verify storage space (models are ~700MB each)

3. **Embed script 404 errors**
   - Ensure build process created `dist/embed.js`
   - Check CORS headers for cross-origin requests

4. **Performance issues**
   - Enable compression on your server
   - Use CDN for static assets
   - Check WebAssembly thread support

### Verification

After deployment, test:

1. **Main application**: Visit your deployed URL
2. **Embed functionality**: Test integration with external site
3. **Model loading**: Verify models download and work
4. **Cross-origin**: Test embed script from different domain

## Security Considerations

- Models are cached locally in browser
- No server-side processing or storage
- Set appropriate CORS policies
- Use HTTPS in production (required for some WebAssembly features)

## Performance Tips

- Use HTTP/2 for better multiplexing
- Enable compression for all text assets
- Set appropriate cache headers
- Consider using a CDN for global distribution
- Monitor Core Web Vitals for user experience