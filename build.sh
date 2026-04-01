#!/bin/bash
set -e

echo "Installing master dependencies..."
cd master
npm install

echo "Installing frontend dependencies..."
cd ../frontend
npm install

echo "Building frontend..."
npm run build

echo "Build complete!"
cd ..
