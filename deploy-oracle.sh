#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
#  StreamX — Oracle Cloud ARM auto-deploy script
#  Run this ON the Oracle VM as the 'ubuntu' user.
#
#  Usage:
#    bash deploy-oracle.sh <your-github-repo-url>
#
#  Example:
#    bash deploy-oracle.sh https://github.com/tu-usuario/streamxdef.git
# ═══════════════════════════════════════════════════════════════

REPO_URL="${1:-}"
if [ -z "$REPO_URL" ]; then
  echo "❌ Uso: bash deploy-oracle.sh <github-repo-url>"
  echo "   Ej: bash deploy-oracle.sh https://github.com/usuario/streamxdef.git"
  exit 1
fi

echo "🚀 Desplegando StreamX en Oracle Cloud..."
echo "   Repo: $REPO_URL"
echo ""

# ─── 1. Instalar Node 20 (ARM) ──────────────────────────────────
echo "📦 Instalando Node 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "   Node: $(node -v)"

# ─── 2. Instalar pm2 (process manager, auto-restart) ────────────
echo "📦 Instalando pm2..."
sudo npm install -g pm2

# ─── 3. Clonar repo ─────────────────────────────────────────────
APP_DIR="$HOME/streamx"
if [ -d "$APP_DIR" ]; then
  echo "🔄 Actualizando repo existente..."
  cd "$APP_DIR" && git pull
else
  echo "📥 Clonando repo..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

# ─── 4. Instalar dependencias ───────────────────────────────────
echo "📦 Instalando dependencias..."
npm ci

# ─── 5. Build producción ────────────────────────────────────────
echo "🔨 Build producción..."
npx next build

# ─── 6. Variables de entorno ────────────────────────────────────
if [ ! -f .env.production ]; then
  echo ""
  echo "⚠️  No hay .env.production. Creándolo — EDITA los valores:"
  cat > .env.production << 'ENVEOF'
TMDB_API_KEY=c5745a7c7ffef7eb77a8c1c37ff958f9
TMDB_BEARER=eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJjNTc0NWE3YzdmZmVmN2ViNzdhOGMxYzM3ZmY5NThmOSIsIm5iZiI6MTc4MjE1NDE4Ni43OTMsInN1YiI6IjZhMzk4M2NhY2VhMDRiMmRjMTIwN2E5MiIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.yenjqj3CNksD-ROshc3AMoxlViuylyTzt4WHxpjiFX4
OPENSUBTITLES_API_KEY=N7r7dXIGi9BDTROFcoI5KT4JdJrQbaNX
ENVEOF
  echo "   ✅ .env.production creado (cambia las keys por las tuyas rotadas)"
else
  echo "   ✅ .env.production ya existe"
fi

# ─── 7. Abrir puertos en iptables (Oracle VMs bloquean todo) ───
echo "🔓 Abriendo puerto 3000 en iptables..."
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT 2>/dev/null || true
sudo netfilter-persistent save 2>/dev/null || true

# ─── 8. Arrancar con pm2 (auto-restart, arranque al boot) ───────
echo "🚀 Arrancando con pm2..."
pm2 delete streamx 2>/dev/null || true
pm2 start "npx next start -p 3000" --name streamx
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu 2>/dev/null || true

# ─── 9. Info final ──────────────────────────────────────────────
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com || echo "TU_IP_PUBLICA")
echo ""
echo "══════════════════════════════════════════════════════════"
echo "✅ StreamX desplegado!"
echo ""
echo "   URL: http://$PUBLIC_IP:3000"
echo ""
echo "   Comandos útiles:"
echo "     pm2 status        # ver estado"
echo "     pm2 logs streamx  # ver logs"
echo "     pm2 restart streamx  # reiniciar"
echo ""
echo "   ⚠️  IMPORTANTE: abre el puerto 3000 también en:"
echo "      Oracle Cloud Console → Networking → VCN → Security Lists"
echo "      Añade Ingress Rule: Source 0.0.0.0/0, TCP, Port 3000"
echo "══════════════════════════════════════════════════════════"
