# LemmaX public page. The public SciFact benchmark data is fetched and checked at build
# time with the repo's own preparation script; it is never committed.
FROM node:22-bookworm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY . .
RUN curl -fsSL -o /tmp/scifact.zip https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip \
 && python3 scripts/prepare-scifact.py --dataset /tmp/scifact.zip --output /app/data/scifact && rm /tmp/scifact.zip
ENV NODE_ENV=production LEMMAX_SCIFACT_DIR=/app/data/scifact
EXPOSE 8080
CMD ["node", "web/server.mjs"]
