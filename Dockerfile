# SIMALIA — Sistem Informasi Manajemen Jadwal Kuliah
# Aplikasi Node.js tanpa dependensi npm (hanya modul bawaan).
FROM node:20-alpine

WORKDIR /app

# Salin manifest lebih dulu (memaksimalkan cache layer).
COPY package.json ./

# Salin seluruh source aplikasi.
COPY . .

# Data persisten disimpan di /app/data (mount volume Coolify ke path ini).
ENV NODE_ENV=production \
    PORT=8099 \
    HOST=0.0.0.0
RUN mkdir -p /app/data

EXPOSE 8099

CMD ["node", "server.js"]
