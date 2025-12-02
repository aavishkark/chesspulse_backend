#!/bin/bash
set -e

echo "Installing Chromium dependencies for Puppeteer..."

# Update package list
apt-get update || true

# Install required system packages for Chromium
apt-get install -y --no-install-recommends \
  libnss3 \
  libxss1 \
  libasound2 \
  libgconf-2-4 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libgdk-pixbuf2.0-0 \
  libgtk-3-0 \
  libgbm1 \
  libpango-1.0-0 \
  libpango-gobject-0 \
  libxcb-dri3-0 \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxinerama1 \
  libxrandr2 \
  libxrender1 \
  libxshmfence1 \
  libxt6 \
  libxtst6 \
  libxvmc1 \
  libxv1 \
  libnss-wrapper || true

echo "Dependencies installed successfully!"
