FROM node:22-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    npm install -g @aman_asmuei/aman-agent@latest && \
    npm cache clean --force && \
    apt-get purge -y python3 make g++ && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

ENV AMAN_HOME=/home/node/.aman-agent
USER node
WORKDIR /home/node

ENTRYPOINT ["aman-agent"]
