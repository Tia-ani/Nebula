#!/bin/bash
# Nebula Worker Auto-Start Script
# Double-click this file to start earning!

echo "🚀 Starting Nebula Worker..."
echo "Email: 25anishkakhurana@gmail.com"
echo "Type: CPU"
echo "Master: http://localhost:3000"
echo ""

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "❌ Ollama is not running!"
    echo ""
    echo "Please start Ollama first:"
    echo "  1. Open Ollama app"
    echo "  2. Or run: ollama serve"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi

echo "✅ Ollama is ready!"
echo ""
echo "Starting worker... Press Ctrl+C to stop"
echo ""

# Start the worker
npx nebula-worker start --master http://localhost:3000 --email 25anishkakhurana@gmail.com
